import { KEYS } from '../storage/kv-schema.js';
import { getStockList } from '../storage/stocklist.js';
import { fetchYahooChart } from '../data/yahoo.js';
import { parseJson, nowIso, normalizeSymbol } from '../utils.js';
import { fetchUsEarningsDataset, usEventsFromDataset } from './us-earnings.js';

const DAY=86400000;
const PROVIDER_CACHE_MS=12*60*60*1000;
const PROVIDER_CACHE_TTL=14*24*60*60;
const EVENT_BATCH_SIZE=10;
const JPX_CACHE_KEY='events:jpx:v1';
const JPX_CACHE_MS=6*60*60*1000;
const JPX_CACHE_TTL=8*24*60*60;
const JPX_DATA_URLS=[
  'https://raw.githubusercontent.com/miyabom1-wq/cockpit/main/public/data/jpx_earnings.json',
  'https://miyabom1-wq.github.io/cockpit/data/jpx_earnings.json'
];

const VERIFIED_EVENTS=Object.freeze([
  {id:'official-4063-20260724',name:'信越化学 2026年1Q決算',time:'2026-07-24T06:30:00.000Z',time_note:'7/24 15:30',category:'earnings',symbols:['4063.T'],source:'official',source_name:'信越化学 IR',official_kind:'company_ir',source_priority:100,read_only:true,pinned:true},
  {id:'official-stx-20260728',name:'Seagate FY2026 Q4・通期決算',time:'2026-07-28T20:00:00.000Z',time_note:'7/28 米国市場終了後',category:'earnings',symbols:['STX'],source:'official',source_name:'Seagate IR',official_kind:'company_ir',source_priority:100,read_only:true,pinned:true},
  {id:'official-2914-20260730',name:'JT 2026年2Q決算',time:'2026-07-30T06:30:00.000Z',time_note:'7/30 15:30',category:'earnings',symbols:['2914.T'],source:'official',source_name:'JT IR',official_kind:'company_ir',source_priority:100,read_only:true,pinned:true},
  {id:'official-7011-20260804',name:'三菱重工 2026年度1Q決算',time:'2026-08-04T04:30:00.000Z',time_note:'8/4 13:30',category:'earnings',symbols:['7011.T'],source:'official',source_name:'三菱重工 IR',official_kind:'company_ir',source_priority:100,read_only:true,pinned:true},
  {id:'official-lite-20260811',name:'Lumentum FY2026 Q4・通期決算',time:'2026-08-11T20:00:00.000Z',time_note:'8/11 米国市場終了後',category:'earnings',symbols:['LITE'],source:'official',source_name:'Lumentum IR',official_kind:'company_ir',source_priority:100,read_only:true,pinned:true}
]);

function normalizeSymbols(value){
  const xs=Array.isArray(value)?value:String(value||'').split(/[\s,、/]+/);
  return[...new Set(xs.map(x=>{
    const s=String(x||'').trim().toUpperCase();if(!s)return null;
    const jp=/\.T$/.test(s)||/^(?=.*\d)[0-9A-Z]{4}$/.test(s);
    return normalizeSymbol(s,jp?'jp':'us');
  }).filter(Boolean))].slice(0,20);
}
function normalizeEvent(x={}){return{...x,symbols:normalizeSymbols(x.symbols||[]),source:x.source||'manual',read_only:!!x.read_only};}
function eventKey(x){return`${String(x.time||'').slice(0,10)}|${normalizeSymbols(x.symbols||[]).sort().join(',')}`;}
function symbolOf(x){return normalizeSymbols(x?.symbols||[])[0]||'';}
function dateLabel(iso){const d=new Date(iso);return Number.isNaN(d.getTime())?'日程未確認':`${d.getUTCMonth()+1}/${d.getUTCDate()}`;}
function phaseOrder(x){return x?.active?0:x?.phase==='tracking'?1:x?.phase==='complete'?2:3;}
function providerKey(symbol){return`events:earnings:v2:${symbol}`;}
function eventPriority(x){
  if(Number.isFinite(Number(x?.source_priority)))return Number(x.source_priority);
  if(x?.official_kind==='company_ir')return 100;
  if(x?.official_kind==='jpx')return 80;
  if(x?.source==='official')return 70;
  if(x?.source==='provider')return 20;
  return 10;
}

async function getManualEvents(env){
  const v=parseJson(await env.COCKPIT_KV.get(KEYS.events),[]);
  return(Array.isArray(v)?v:[]).map(normalizeEvent).filter(x=>x.source!=='official'&&x.source!=='provider');
}

export function trackedEventUniverse({watch=[],signals=[],registered={jp:[],us:[]}}={}){
  const out=[],seen=new Set();
  const add=(x,scope,marketHint=null)=>{
    const market=(x?.market||marketHint)==='us'?'us':'jp',symbol=normalizeSymbol(x?.symbol,market);
    if(!symbol||seen.has(symbol))return;
    seen.add(symbol);out.push({symbol,name:String(x?.name||symbol).slice(0,100),market,scope});
  };
  for(const x of watch||[])add(x,'watch');
  for(const x of [...(signals||[])].sort((a,b)=>phaseOrder(a)-phaseOrder(b)||String(b?.last_seen_date||b?.start_date||'').localeCompare(String(a?.last_seen_date||a?.start_date||''))))add(x,'signal');
  for(const x of registered?.jp||[])add(x,'registered','jp');
  for(const x of registered?.us||[])add(x,'registered','us');
  return out;
}

export function eventSyncBatch(items=[],batch=0,batchSize=EVENT_BATCH_SIZE){
  const size=Math.max(1,Math.min(20,Number(batchSize)||EVENT_BATCH_SIZE));
  const total=items.length,batchCount=Math.max(1,Math.ceil(total/size));
  const index=Math.max(0,Math.min(batchCount-1,Number(batch)||0));
  return{batch:index,batch_count:batchCount,batch_size:size,total,items:items.slice(index*size,(index+1)*size)};
}

async function readTracked(env){
  const [watchRaw,signalV5Raw,signalV3Raw,jp,us]=await Promise.all([
    env.COCKPIT_KV.get(KEYS.watch).then(x=>parseJson(x,[])),
    env.COCKPIT_KV.get(KEYS.signalV5).then(x=>parseJson(x,null)),
    env.COCKPIT_KV.get(KEYS.signalV3).then(x=>parseJson(x,{items:[]})),
    getStockList(env,'jp'),
    getStockList(env,'us')
  ]);
  const signalRaw=signalV5Raw??signalV3Raw;
  const watch=Array.isArray(watchRaw)?watchRaw:[],signals=Array.isArray(signalRaw)?signalRaw:(signalRaw?.items||[]);
  return trackedEventUniverse({watch,signals,registered:{jp,us}});
}

export function officialEvents(now=Date.now(),tracked=null){
  const set=tracked instanceof Set?tracked:null;
  return VERIFIED_EVENTS
    .filter(x=>Date.parse(x.time)>=now-DAY&&Date.parse(x.time)<=now+120*DAY)
    .filter(x=>!set||x.symbols.some(s=>set.has(s)))
    .map(normalizeEvent);
}

export function parseCalendarEventPayload(payload,{symbol,name,market,scope}={}){
  const earnings=payload?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
  const values=(earnings?.earningsDate||[]).map(x=>Number(x?.raw)).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
  if(!values.length)return null;
  const time=new Date(values[0]*1000).toISOString(),rangeEnd=values.length>1?new Date(values.at(-1)*1000).toISOString():null;
  return normalizeEvent({
    id:`provider-${String(symbol).toLowerCase()}-${time.slice(0,10)}`,
    name:`${name||symbol} 決算予定`,time,
    time_note:rangeEnd&&rangeEnd.slice(0,10)!==time.slice(0,10)?`${dateLabel(time)}〜${dateLabel(rangeEnd)}・時刻未確認`:`${dateLabel(time)}・時刻未確認`,
    category:'earnings',symbols:[symbol],source:'provider',source_name:'Yahoo Finance calendarEvents',
    source_priority:20,read_only:true,pinned:false,market,tracked_scope:scope,provider_range_end:rangeEnd,provider_fetched_at:nowIso()
  });
}

export function parseChartMetaEvent(meta,{symbol,name,market,scope}={}){
  const values=[meta?.earningsTimestamp,meta?.earningsTimestampStart,meta?.earningsTimestampEnd]
    .map(Number).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
  if(!values.length)return null;
  const time=new Date(values[0]*1000).toISOString();
  const rangeEnd=values.length>1?new Date(values.at(-1)*1000).toISOString():null;
  return normalizeEvent({
    id:`provider-${String(symbol).toLowerCase()}-${time.slice(0,10)}`,
    name:`${name||symbol} 決算予定`,time,
    time_note:rangeEnd&&rangeEnd.slice(0,10)!==time.slice(0,10)?`${dateLabel(time)}〜${dateLabel(rangeEnd)}・時刻未確認`:`${dateLabel(time)}・時刻未確認`,
    category:'earnings',symbols:[symbol],source:'provider',source_name:'Yahoo Finance chart metadata',
    source_priority:20,read_only:true,pinned:false,market,tracked_scope:scope,provider_range_end:rangeEnd,provider_fetched_at:nowIso()
  });
}

async function fetchProviderCalendar(item){
  let last=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const url=`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(item.symbol)}?modules=calendarEvents&formatted=false`;
      const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; VANTAGE/57.0)','Accept':'application/json,text/plain,*/*'},cf:{cacheTtl:120}});
      if(!res.ok){last=new Error(`${item.symbol} calendar HTTP ${res.status}`);continue;}
      const event=parseCalendarEventPayload(await res.json(),item);
      if(event)return event;
      last=new Error(`${item.symbol} calendar missing`);
    }catch(e){last=e;}
  }
  try{
    const chart=await fetchYahooChart(item.symbol,{range:'5d',cacheTtl:60});
    const event=parseChartMetaEvent(chart?.meta||{},item);
    if(event)return event;
    last=new Error(`${item.symbol} chart earnings metadata missing`);
  }catch(e){last=e;}
  throw last||new Error(`${item.symbol} calendar fetch failed`);
}

async function readProviderCache(env,symbol){
  const current=parseJson(await env.COCKPIT_KV.get(providerKey(symbol)),null);
  if(current)return current;
  return parseJson(await env.COCKPIT_KV.get(`events:earnings:v1:${symbol}`),null);
}
async function providerEvent(env,item,force=false){
  const key=providerKey(item.symbol),cached=await readProviderCache(env,item.symbol);
  if(!force&&cached&&Date.now()-Date.parse(cached.fetched_at||0)<PROVIDER_CACHE_MS)return cached.event?normalizeEvent({...cached.event,tracked_scope:item.scope}):null;
  try{
    const event=await fetchProviderCalendar(item);
    await env.COCKPIT_KV.put(key,JSON.stringify({fetched_at:nowIso(),event}),{expirationTtl:PROVIDER_CACHE_TTL});
    return event;
  }catch(error){
    await env.COCKPIT_KV.put(key,JSON.stringify({fetched_at:nowIso(),event:null,error:String(error?.message||error).slice(0,180)}),{expirationTtl:PROVIDER_CACHE_TTL});
    return null;
  }
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}

export function validJpxDataset(value){
  const generated=Date.parse(value?.generated_at||'');
  return Boolean(
    value&&
    typeof value==='object'&&
    Array.isArray(value.events)&&
    value.events.length>0&&
    Number.isFinite(generated)&&
    String(value.schema||'').startsWith('vantage-jpx-earnings')
  );
}

export function jpxFetchOptions(bust=false){
  const base={
    headers:{'Accept':'application/json','User-Agent':'VANTAGE/57.2'}
  };
  return bust
    ?{...base,cache:'no-store'}
    :{...base,cf:{cacheTtl:120}};
}

async function fetchJpxDataset(env,{force=false}={}){
  const cached=parseJson(await env.COCKPIT_KV.get(JPX_CACHE_KEY),null);
  const cachedValid=validJpxDataset(cached?.dataset);
  if(!force&&cachedValid&&Date.now()-Date.parse(cached.fetched_at||0)<JPX_CACHE_MS){
    return{available:true,dataset:cached.dataset,fetched_at:cached.fetched_at,source_url:cached.source_url,stale:false,error:null};
  }

  let last=null;
  for(const base of JPX_DATA_URLS){
    try{
      const bust=force||!cachedValid;
      const url=bust?`${base}${base.includes('?')?'&':'?'}ts=${Date.now()}`:base;
      const res=await fetch(url,jpxFetchOptions(bust));
      if(!res.ok){last=new Error(`JPX JSON HTTP ${res.status}`);continue;}
      const dataset=await res.json();
      if(!validJpxDataset(dataset)){last=new Error('JPX JSON schema invalid');continue;}
      const record={fetched_at:nowIso(),source_url:base,dataset};
      await env.COCKPIT_KV.put(JPX_CACHE_KEY,JSON.stringify(record),{expirationTtl:JPX_CACHE_TTL});
      return{available:true,dataset,fetched_at:record.fetched_at,source_url:base,stale:false,error:null};
    }catch(error){
      last=error;
    }
  }

  if(cachedValid){
    return{available:true,dataset:cached.dataset,fetched_at:cached.fetched_at,source_url:cached.source_url,stale:true,error:String(last?.message||last||'JPX data fetch failed')};
  }
  return{available:false,dataset:null,fetched_at:null,source_url:null,stale:false,error:String(last?.message||last||'JPX data unavailable')};
}

export function jpxEventsFromDataset(dataset,tracked=[],now=Date.now()){
  if(!validJpxDataset(dataset))return[];
  const trackedMap=new Map((tracked||[]).filter(x=>x.market==='jp').map(x=>[String(x.symbol).toUpperCase(),x]));
  const out=[];
  for(const row of dataset.events||[]){
    const raw=String(row.symbol||row.code||'').toUpperCase();
    const symbol=normalizeSymbol(raw.endsWith('.T')?raw:raw.replace(/\.0$/,'').replace(/^([0-9A-Z]{4})0$/,'$1'),'jp');
    const item=trackedMap.get(symbol);
    if(!item)continue;
    const time=String(row.time||`${row.date}T14:59:00.000Z`);
    const ms=Date.parse(time);
    if(!Number.isFinite(ms)||ms<now-DAY||ms>now+120*DAY)continue;
    out.push(normalizeEvent({
      id:`jpx-${symbol.toLowerCase()}-${time.slice(0,10)}`,
      name:`${item.name||row.name||symbol} 決算予定`,
      time,fiscal_period_raw:row.period||row.fiscal_label||null,
      time_note:`${dateLabel(time)}・時刻未確認`,
      category:'earnings',symbols:[symbol],source:'official',source_name:'JPX 決算発表予定日',
      official_kind:'jpx',source_priority:80,source_url:row.source_url||dataset.source_page||null,
      read_only:true,pinned:false,market:'jp',tracked_scope:item.scope,
      official_dataset_generated_at:dataset.generated_at||null
    }));
  }
  return out;
}

export async function syncRegisteredEventBatch(env,{batch=0,batchSize=EVENT_BATCH_SIZE}={}){
  const tracked=await readTracked(env),plan=eventSyncBatch(tracked,batch,batchSize);
  const [jpxState,usState]=await Promise.all([fetchJpxDataset(env,{force:plan.batch===0}),fetchUsEarningsDataset(env,{force:plan.batch===0})]);
  const jpxEvents=jpxEventsFromDataset(jpxState.dataset,plan.items),usEvents=usEventsFromDataset(usState.dataset,plan.items);
  const covered=new Set([...jpxEvents,...usEvents].flatMap(x=>x.symbols||[]));
  const results=await mapLimit(plan.items.filter(x=>!covered.has(x.symbol)),2,x=>providerEvent(env,x,true));
  const foundSymbols=new Set([...results.filter(Boolean).flatMap(x=>x.symbols||[]),...jpxEvents.flatMap(x=>x.symbols||[]),...usEvents.flatMap(x=>x.symbols||[])]);
  return{ok:true,batch:plan.batch,batch_count:plan.batch_count,batch_size:plan.batch_size,total:plan.total,processed:plan.items.length,found:foundSymbols.size,missing:Math.max(0,plan.items.length-foundSymbols.size),next_batch:plan.batch+1<plan.batch_count?plan.batch+1:null,complete:plan.batch+1>=plan.batch_count,jpx:{available:jpxState.available,stale:jpxState.stale,error:jpxState.error,generated_at:jpxState.dataset?.generated_at||null,event_count:jpxState.dataset?.events?.length||0},us_calendar:{available:usState.available,stale:usState.stale,error:usState.error,generated_at:usState.dataset?.generated_at||null,event_count:usState.dataset?.events?.length||0}};
}

export function eventCoverageSummary(tracked=[],automaticEvents=[],checkedSymbols=new Set(),lastCheckedAt=null,meta={}){
  const checked=checkedSymbols instanceof Set?checkedSymbols:new Set(checkedSymbols||[]);
  const trackedMap=new Map((tracked||[]).map(item=>[String(item.symbol||'').toUpperCase(),item]));
  const foundSymbols=new Set(),officialSymbols=new Set(),jpxSymbols=new Set(),providerSymbols=new Set(),nasdaqSymbols=new Set();

  for(const event of automaticEvents||[]){
    if(event?.category!=='earnings')continue;
    for(const symbol of normalizeSymbols(event.symbols||[])){
      if(!trackedMap.has(symbol))continue;
      foundSymbols.add(symbol);
      if(event.source==='provider'){providerSymbols.add(symbol);if(event.provider_kind==='nasdaq_zacks')nasdaqSymbols.add(symbol);}
      else if(event.source==='official'){
        officialSymbols.add(symbol);
        if(event.official_kind==='jpx'||String(event.source_name||'').startsWith('JPX'))jpxSymbols.add(symbol);
      }
    }
  }

  const missing=[],unchecked=[];
  for(const item of trackedMap.values()){
    if(foundSymbols.has(item.symbol))continue;
    if(checked.has(item.symbol))missing.push(item);
    else unchecked.push(item);
  }

  const marketSummary=market=>{
    const items=[...trackedMap.values()].filter(item=>item.market===market);
    const symbols=new Set(items.map(item=>item.symbol));
    const count=set=>[...set].filter(symbol=>symbols.has(symbol)).length;
    return{
      total:items.length,checked:[...checked].filter(symbol=>symbols.has(symbol)).length,
      found:count(foundSymbols),official:count(officialSymbols),jpx:count(jpxSymbols),provider:count(providerSymbols),nasdaq:count(nasdaqSymbols),
      missing:missing.filter(item=>item.market===market).length,
      unchecked:unchecked.filter(item=>item.market===market).length
    };
  };

  return{
    window_days:120,tracked_total:trackedMap.size,
    checked_total:[...checked].filter(symbol=>trackedMap.has(symbol)).length,
    earnings_found:foundSymbols.size,official_found:officialSymbols.size,jpx_found:jpxSymbols.size,provider_found:providerSymbols.size,nasdaq_found:nasdaqSymbols.size,
    missing_total:missing.length,not_listed_total:missing.length,unchecked_total:unchecked.length,
    by_market:{jp:marketSummary('jp'),us:marketSummary('us')},
    missing_symbols:missing.map(item=>({symbol:item.symbol,name:item.name,market:item.market,scope:item.scope})),
    unchecked_symbols:unchecked.map(item=>({symbol:item.symbol,name:item.name,market:item.market,scope:item.scope})),
    last_checked_at:lastCheckedAt,jpx:meta.jpx||null,us_calendar:meta.us_calendar||null,
    source_policy:'JPX free official schedule for Japan, company IR overrides, Yahoo next earnings date as supplemental reference. Not listed does not mean no earnings.'
  };
}

async function buildEventDashboard(env,now=Date.now(),force=false){
  const manual=await getManualEvents(env),tracked=await readTracked(env),trackedSet=new Set(tracked.map(x=>x.symbol));
  if(force&&tracked.length)await syncRegisteredEventBatch(env,{batch:0});

  const [jpxState,usState]=await Promise.all([fetchJpxDataset(env,{force:false}),fetchUsEarningsDataset(env,{force:false})]);
  const verified=officialEvents(now,trackedSet);
  const jpx=jpxEventsFromDataset(jpxState.dataset,tracked,now);
  const usCalendar=usEventsFromDataset(usState.dataset,tracked,now);
  const cachedRows=await Promise.all(tracked.map(async item=>({item,cached:await readProviderCache(env,item.symbol)})));
  const dynamic=cachedRows
    .map(({item,cached})=>cached?.event?normalizeEvent({...cached.event,tracked_scope:item.scope}):null)
    .filter(Boolean)
    .filter(x=>Date.parse(x.time)>=now-DAY&&Date.parse(x.time)<=now+120*DAY);

  const manualKeys=new Set(manual.map(eventKey));
  const readOnly=[...verified,...jpx,...usCalendar,...dynamic].filter(x=>!manualKeys.has(eventKey(x)));
  const bySymbol=new Map();
  for(const x of readOnly){
    const s=symbolOf(x),old=bySymbol.get(s);
    if(!old||eventPriority(x)>eventPriority(old)||(eventPriority(x)===eventPriority(old)&&Date.parse(x.time)<Date.parse(old.time)))bySymbol.set(s,x);
  }

  const events=[...manual,...bySymbol.values()].sort((a,b)=>new Date(a.time)-new Date(b.time));
  const checkedSymbols=new Set(verified.flatMap(event=>event.symbols||[]));
  let lastCheckedAt=[jpxState.dataset?.generated_at,usState.dataset?.generated_at].filter(Boolean).sort().at(-1)||null;

  if(jpxState.available){
    for(const item of tracked)if(item.market==='jp')checkedSymbols.add(item.symbol);
  }
  if(usState.available){
    for(const item of tracked)if(item.market==='us')checkedSymbols.add(item.symbol);
  }
  for(const {item,cached} of cachedRows){
    if(cached?.fetched_at){
      checkedSymbols.add(item.symbol);
      if(!lastCheckedAt||Date.parse(cached.fetched_at)>Date.parse(lastCheckedAt))lastCheckedAt=cached.fetched_at;
    }
  }

  const jpxMeta={
    available:jpxState.available,stale:jpxState.stale,error:jpxState.error,
    generated_at:jpxState.dataset?.generated_at||null,
    source_page:jpxState.dataset?.source_page||null,
    source_files:jpxState.dataset?.source_files||[],
    event_count:jpxState.dataset?.events?.length||0,
    stats:jpxState.dataset?.stats||null
  };

  const usMeta={available:usState.available,stale:usState.stale,error:usState.error,generated_at:usState.dataset?.generated_at||null,source_page:usState.dataset?.source_page||null,event_count:usState.dataset?.events?.length||0,stats:usState.dataset?.stats||null};
  return{
    events,
    coverage:eventCoverageSummary(tracked,[...verified,...jpx,...usCalendar,...dynamic],checkedSymbols,lastCheckedAt,{jpx:jpxMeta,us_calendar:usMeta}),
    generated_at:nowIso()
  };
}

export async function getEventDashboard(env,now=Date.now(),force=false){return buildEventDashboard(env,now,force);}
export async function getEvents(env,now=Date.now(),force=false){return(await buildEventDashboard(env,now,force)).events;}

async function save(env,list){await env.COCKPIT_KV.put(KEYS.events,JSON.stringify(list));}
export async function mutateEvent(env,body={}){
  const action=body.action||'get',list=await getManualEvents(env);
  if(action==='add'){
    const name=String(body.name||'').trim().slice(0,120),time=String(body.time||'');if(!name||!Number.isFinite(new Date(time).getTime()))throw new Error('イベント名と日時が必要です');
    const item={id:`e${Date.now()}${Math.random().toString(36).slice(2,6)}`,name,time,category:String(body.category||'other').slice(0,20),symbols:normalizeSymbols(body.symbols),source:'manual',pinned:false,read_only:false,created_at:nowIso()};list.push(item);list.sort((a,b)=>new Date(a.time)-new Date(b.time));await save(env,list);return{ok:true,event:item};
  }
  if(action==='delete'){const next=list.filter(x=>x.id!==body.id);await save(env,next);return{ok:true,removed:list.length-next.length};}
  if(action==='toggle_pin'){const x=list.find(x=>x.id===body.id);if(x)x.pinned=!x.pinned;await save(env,list);return{ok:true,changed:x?1:0,pinned:x?.pinned};}
  if(action==='clear_completed'){const ids=new Set(Array.isArray(body.ids)?body.ids:[]),now=Date.now(),next=list.filter(x=>x.pinned||(!ids.size?new Date(x.time).getTime()>=now:!ids.has(x.id)));await save(env,next);return{ok:true,removed:list.length-next.length};}
  return{ok:false,error:'unknown action'};
}

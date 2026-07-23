import { KEYS } from '../storage/kv-schema.js';
import { getStockList } from '../storage/stocklist.js';
import { parseJson, nowIso, normalizeSymbol } from '../utils.js';

const DAY=86400000;
const PROVIDER_CACHE_MS=12*60*60*1000;
const PROVIDER_CACHE_TTL=14*24*60*60;
const EVENT_BATCH_SIZE=20;
const VERIFIED_EVENTS=Object.freeze([
  {id:'official-4063-20260724',name:'信越化学 2026年1Q決算',time:'2026-07-24T06:30:00.000Z',time_note:'7/24 15:30',category:'earnings',symbols:['4063.T'],source:'official',source_name:'信越化学 IR',read_only:true,pinned:true},
  {id:'official-stx-20260728',name:'Seagate FY2026 Q4・通期決算',time:'2026-07-28T20:00:00.000Z',time_note:'7/28 米国市場終了後',category:'earnings',symbols:['STX'],source:'official',source_name:'Seagate IR',read_only:true,pinned:true},
  {id:'official-2914-20260730',name:'JT 2026年2Q決算',time:'2026-07-30T06:30:00.000Z',time_note:'7/30 15:30',category:'earnings',symbols:['2914.T'],source:'official',source_name:'JT IR',read_only:true,pinned:true},
  {id:'official-7011-20260804',name:'三菱重工 2026年度1Q決算',time:'2026-08-04T04:30:00.000Z',time_note:'8/4 13:30',category:'earnings',symbols:['7011.T'],source:'official',source_name:'三菱重工 IR',read_only:true,pinned:true},
  {id:'official-lite-20260811',name:'Lumentum FY2026 Q4・通期決算',time:'2026-08-11T20:00:00.000Z',time_note:'8/11 米国市場終了後',category:'earnings',symbols:['LITE'],source:'official',source_name:'Lumentum IR',read_only:true,pinned:true}
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
    read_only:true,pinned:false,market,tracked_scope:scope,provider_range_end:rangeEnd,provider_fetched_at:nowIso()
  });
}

async function fetchProviderCalendar(item){
  let last=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const url=`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(item.symbol)}?modules=calendarEvents&formatted=false`;
      const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; VANTAGE/53.0)','Accept':'application/json,text/plain,*/*'},cf:{cacheTtl:300}});
      if(!res.ok){last=new Error(`${item.symbol} calendar HTTP ${res.status}`);continue;}
      const event=parseCalendarEventPayload(await res.json(),item);
      if(event)return event;
      last=new Error(`${item.symbol} calendar missing`);
    }catch(e){last=e;}
  }
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
async function cachedProviderEvent(env,item){
  const cached=await readProviderCache(env,item.symbol);
  return cached?.event?normalizeEvent({...cached.event,tracked_scope:item.scope}):null;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}

export async function syncRegisteredEventBatch(env,{batch=0,batchSize=EVENT_BATCH_SIZE}={}){
  const tracked=await readTracked(env),plan=eventSyncBatch(tracked,batch,batchSize);
  const results=await mapLimit(plan.items,5,x=>providerEvent(env,x,true));
  const found=results.filter(Boolean).length;
  return{ok:true,batch:plan.batch,batch_count:plan.batch_count,batch_size:plan.batch_size,total:plan.total,processed:plan.items.length,found,missing:plan.items.length-found,next_batch:plan.batch+1<plan.batch_count?plan.batch+1:null,complete:plan.batch+1>=plan.batch_count};
}

export async function getEvents(env,now=Date.now(),force=false){
  const manual=await getManualEvents(env),tracked=await readTracked(env),trackedSet=new Set(tracked.map(x=>x.symbol));
  if(force&&tracked.length)await syncRegisteredEventBatch(env,{batch:0});
  const verified=officialEvents(now,trackedSet),verifiedSymbols=new Set(verified.map(symbolOf));
  const candidates=tracked.filter(x=>!verifiedSymbols.has(x.symbol));
  const dynamic=(await Promise.all(candidates.map(x=>cachedProviderEvent(env,x)))).filter(Boolean)
    .filter(x=>Date.parse(x.time)>=now-DAY&&Date.parse(x.time)<=now+120*DAY);
  const manualKeys=new Set(manual.map(eventKey)),readOnly=[...verified,...dynamic].filter(x=>!manualKeys.has(eventKey(x)));
  const bySymbol=new Map();
  for(const x of readOnly){
    const s=symbolOf(x),old=bySymbol.get(s);
    if(!old||x.source==='official'||Date.parse(x.time)<Date.parse(old.time))bySymbol.set(s,x);
  }
  return[...manual,...bySymbol.values()].sort((a,b)=>new Date(a.time)-new Date(b.time));
}

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

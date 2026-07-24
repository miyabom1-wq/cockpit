import { parseJson, nowIso, normalizeSymbol } from '../utils.js';

const DAY=86400000;
const CACHE_KEY='events:us-calendar:v1';
const CACHE_MS=6*60*60*1000;
const CACHE_TTL=8*24*60*60;
const DATA_URLS=[
  'https://raw.githubusercontent.com/miyabom1-wq/cockpit/main/public/data/us_earnings.json',
  'https://miyabom1-wq.github.io/cockpit/data/us_earnings.json'
];

export function validUsEarningsDataset(value){
  const generated=Date.parse(value?.generated_at||'');
  return Boolean(
    value&&typeof value==='object'&&Array.isArray(value.events)&&value.events.length>0&&
    Number.isFinite(generated)&&String(value.schema||'').startsWith('vantage-us-earnings')
  );
}

export function usEarningsFetchOptions(bust=false){
  const base={headers:{'Accept':'application/json','User-Agent':'VANTAGE/60.0'}};
  return bust?{...base,cache:'no-store'}:{...base,cf:{cacheTtl:120}};
}

export async function fetchUsEarningsDataset(env,{force=false}={}){
  const cached=parseJson(await env.COCKPIT_KV.get(CACHE_KEY),null);
  const cachedValid=validUsEarningsDataset(cached?.dataset);
  if(!force&&cachedValid&&Date.now()-Date.parse(cached.fetched_at||0)<CACHE_MS){
    return{available:true,dataset:cached.dataset,fetched_at:cached.fetched_at,source_url:cached.source_url,stale:false,error:null};
  }
  let last=null;
  for(const base of DATA_URLS){
    try{
      const bust=force||!cachedValid;
      const url=bust?`${base}${base.includes('?')?'&':'?'}ts=${Date.now()}`:base;
      const res=await fetch(url,usEarningsFetchOptions(bust));
      if(!res.ok){last=new Error(`US earnings JSON HTTP ${res.status}`);continue;}
      const dataset=await res.json();
      if(!validUsEarningsDataset(dataset)){last=new Error('US earnings JSON schema invalid');continue;}
      const record={fetched_at:nowIso(),source_url:base,dataset};
      await env.COCKPIT_KV.put(CACHE_KEY,JSON.stringify(record),{expirationTtl:CACHE_TTL});
      return{available:true,dataset,fetched_at:record.fetched_at,source_url:base,stale:false,error:null};
    }catch(error){last=error;}
  }
  if(cachedValid){
    return{available:true,dataset:cached.dataset,fetched_at:cached.fetched_at,source_url:cached.source_url,stale:true,error:String(last?.message||last||'US earnings fetch failed')};
  }
  return{available:false,dataset:null,fetched_at:null,source_url:null,stale:false,error:String(last?.message||last||'US earnings unavailable')};
}

function timingNote(timing){
  if(timing==='pre_market')return'米国市場開始前';
  if(timing==='after_hours')return'米国市場終了後';
  return'時刻未公表';
}

export function usEventsFromDataset(dataset,tracked=[],now=Date.now()){
  if(!validUsEarningsDataset(dataset))return[];
  const trackedMap=new Map(
    (tracked||[]).filter(x=>x.market==='us').map(x=>[normalizeSymbol(x.symbol,'us'),x])
  );
  const out=[];
  for(const row of dataset.events||[]){
    const symbol=normalizeSymbol(row.symbol,'us');
    const item=trackedMap.get(symbol);
    if(!item)continue;
    const time=String(row.time||`${row.date}T12:00:00.000Z`);
    const ms=Date.parse(time);
    if(!Number.isFinite(ms)||ms<now-DAY||ms>now+120*DAY)continue;
    const timing=String(row.timing||'unspecified');
    out.push({
      id:`nasdaq-${symbol.toLowerCase()}-${String(row.date||time).slice(0,10)}`,
      name:`${item.name||row.name||symbol} 決算予定`,
      time,
      time_note:timingNote(timing),
      category:'earnings',
      symbols:[symbol],
      source:'provider',
      source_name:'Nasdaq earnings calendar / Zacks',
      provider_kind:'nasdaq_zacks',
      source_priority:45,
      read_only:true,
      pinned:false,
      market:'us',
      tracked_scope:item.scope,
      fiscal_quarter_ending:row.fiscal_quarter_ending||null,
      eps_forecast:row.eps_forecast||null,
      provider_fetched_at:dataset.generated_at||null
    });
  }
  return out;
}

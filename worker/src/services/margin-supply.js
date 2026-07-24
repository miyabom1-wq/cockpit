import { KEYS } from '../storage/kv-schema.js';
import { finite, nowIso, parseJson, round } from '../utils.js';

export const MARGIN_DATA_SCHEMA='jp-margin-v1';
const PUBLIC_DATA_URLS=['https://raw.githubusercontent.com/miyabom1-wq/cockpit/main/public/data/jp-margin.json','https://miyabom1-wq.github.io/cockpit/data/jp-margin.json'];
const CACHE_TTL=6*3600;
const MAX_STALE_MS=16*24*3600*1000;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const pctChange=(value,base)=>finite(value)&&finite(base)&&Number(base)!==0?(Number(value)-Number(base))/Math.abs(Number(base))*100:null;
function normalizedSymbol(v){const s=String(v||'').toUpperCase().trim();return /\.T$/.test(s)?s:/^[0-9A-Z]{4}$/.test(s)?`${s}.T`:s;}
function validDataset(x){return x&&x.schema===MARGIN_DATA_SCHEMA&&x.items&&typeof x.items==='object';}
function datasetAgeMs(x){const t=Date.parse(x?.generated_at||x?.weekly?.published_at||0);return Number.isFinite(t)?Math.max(0,Date.now()-t):Infinity;}

export function evaluateMarginSupply(analysis,item){
  const weekly=item?.weekly||null,flags=item?.flags||{},reasons=[],cautions=[];
  if(!weekly){
    if(flags.margin_restriction)cautions.push('信用取引規制中');
    if(flags.special_notice)cautions.push('特別周知銘柄');
    if(flags.daily_disclosure)cautions.push('日々公表銘柄（規制とは別）');
    return{available:false,label:cautions.length?'需給注意':'データ待ち',score:flags.margin_restriction?-12:flags.special_notice?-8:flags.daily_disclosure?-2:0,as_of:null,published_at:null,summary:cautions.join(' / ')||'週次信用残の取得待ち',reasons,cautions,flags,add_blocked:!!(flags.margin_restriction||flags.special_notice),position_cap:flags.margin_restriction?'reduced':'normal'};
  }
  const buy=finite(weekly.buy_balance)?Number(weekly.buy_balance):null,sell=finite(weekly.sell_balance)?Number(weekly.sell_balance):null,buyChangePct=finite(weekly.buy_change_pct)?Number(weekly.buy_change_pct):pctChange(buy,finite(weekly.buy_change)?buy-Number(weekly.buy_change):null),sellChangePct=finite(weekly.sell_change_pct)?Number(weekly.sell_change_pct):pctChange(sell,finite(weekly.sell_change)?sell-Number(weekly.sell_change):null);
  const ratio=finite(weekly.ratio)?Number(weekly.ratio):(finite(buy)&&finite(sell)&&sell>0?buy/sell:null),avgVol=finite(analysis?.avg_volume20)?Number(analysis.avg_volume20):null,turnover=finite(buy)&&finite(avgVol)&&avgVol>0?buy/avgVol:null,ret5=finite(analysis?.ret5)?Number(analysis.ret5):null;
  let score=0;
  if(finite(ret5)&&finite(buyChangePct)){
    if(ret5>0&&buyChangePct<=-5){score+=12;reasons.push('株価上昇と信用買残減少が同時進行');}
    else if(ret5<0&&buyChangePct>=5){score-=15;cautions.push('株価下落中に信用買残が増加');}
    else if(ret5>0&&buyChangePct>=10){score-=5;cautions.push('上昇を信用買いが追随');}
    else if(ret5<0&&buyChangePct<=-5){score+=5;reasons.push('下落中に信用整理が進行');}
  }
  if(finite(buyChangePct)){
    if(buyChangePct<=-15){score+=8;reasons.push(`信用買残が前週比${round(buyChangePct,1)}%減少`);}
    else if(buyChangePct>=20){score-=10;cautions.push(`信用買残が前週比${round(buyChangePct,1)}%急増`);}
    else if(buyChangePct>=10){score-=6;cautions.push(`信用買残が前週比${round(buyChangePct,1)}%増加`);}
  }
  if(finite(turnover)){
    if(turnover>=5){score-=15;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover>=3){score-=8;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover>=2){score-=4;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover<.8){score+=5;reasons.push('買残は平均出来高1日分未満');}
  }
  if(finite(ratio)){
    if(ratio>=20){score-=8;cautions.push(`信用倍率${round(ratio,1)}倍`);}
    else if(ratio>=10){score-=4;cautions.push(`信用倍率${round(ratio,1)}倍`);}
    else if(ratio<1){score+=5;reasons.push('売残が買残を上回る');}
  }else if(finite(buy)&&buy>0&&sell===0){score-=5;cautions.push('信用売残ゼロ');}
  if(finite(weekly.buy_4w_change_pct)){
    const v=Number(weekly.buy_4w_change_pct);if(v>=30){score-=7;cautions.push(`4週で買残${round(v,1)}%増加`);}else if(v<=-25){score+=6;reasons.push(`4週で買残${round(Math.abs(v),1)}%減少`);}
  }
  if(flags.daily_disclosure){score-=2;cautions.push('日々公表銘柄（注意喚起・規制ではない）');}
  if(flags.special_notice){score-=10;cautions.push('特別周知銘柄');}
  if(flags.margin_restriction){score-=12;cautions.push('信用取引規制中');}
  score=clamp(round(score,1),-40,30);
  const label=score>=11?'需給追い風':score>=4?'需給改善':score<=-18?'需給警戒':score<=-7?'需給悪化':'中立';
  const addBlocked=!!(flags.margin_restriction||flags.special_notice);
  const summary=[label,finite(buyChangePct)?`買残前週比 ${buyChangePct>=0?'+':''}${round(buyChangePct,1)}%`:null,finite(ratio)?`倍率 ${round(ratio,1)}倍`:null,finite(turnover)?`買残回転 ${round(turnover,1)}日`:null].filter(Boolean).join(' / ');
  return{available:true,label,score,as_of:weekly.as_of||null,published_at:weekly.published_at||null,buy_balance:finite(buy)?buy:null,sell_balance:finite(sell)?sell:null,buy_change:finite(weekly.buy_change)?Number(weekly.buy_change):null,sell_change:finite(weekly.sell_change)?Number(weekly.sell_change):null,buy_change_pct:finite(buyChangePct)?round(buyChangePct,1):null,sell_change_pct:finite(sellChangePct)?round(sellChangePct,1):null,buy_4w_change_pct:finite(weekly.buy_4w_change_pct)?Number(weekly.buy_4w_change_pct):null,ratio:finite(ratio)?round(ratio,2):null,buy_turnover_days:finite(turnover)?round(turnover,2):null,summary,reasons,cautions,flags,add_blocked:addBlocked,position_cap:addBlocked?'reduced':score<=-18?'reduced':'normal',source_url:weekly.source_url||null};
}

async function fetchPublicDataset(){
  let last=null;
  for(const base of PUBLIC_DATA_URLS){
    try{
      const res=await fetch(`${base}?v=${Date.now()}`,{headers:{Accept:'application/json','Cache-Control':'no-cache','User-Agent':'VANTAGE/53 margin-supply'},cf:{cacheTtl:0}});
      if(!res.ok){last=new Error(`信用需給データ HTTP ${res.status}`);continue;}
      const data=await res.json();
      if(!validDataset(data)){last=new Error('信用需給データ形式が不正です');continue;}
      return{...data,worker_sync_source:base,worker_synced_at:nowIso()};
    }catch(error){last=error;}
  }
  throw last||new Error('信用需給データを取得できませんでした');
}
export async function getMarginDataset(env,{force=false,fetchIfMissing=true}={}){
  const cached=parseJson(await env.COCKPIT_KV.get(KEYS.marginSupply),null);
  if(!force&&validDataset(cached))return{...cached,stale:datasetAgeMs(cached)>MAX_STALE_MS};
  if(!force&&!fetchIfMissing)return{schema:MARGIN_DATA_SCHEMA,generated_at:null,weekly:{as_of:null,count:0,status:'cache-waiting'},rules:{},source:{},items:{}};
  try{const data=await fetchPublicDataset();await env.COCKPIT_KV.put(KEYS.marginSupply,JSON.stringify(data));return data;}
  catch(e){if(validDataset(cached))return{...cached,cache_warning:e?.message||String(e),stale:datasetAgeMs(cached)>MAX_STALE_MS};throw e;}
}

export function enrichMarginSupply(rows,dataset){
  if(!Array.isArray(rows))return rows;const items=dataset?.items||{};
  for(const row of rows){
    if(row?.market!=='jp')continue;const item=items[normalizedSymbol(row.symbol)]||items[String(row.symbol||'').replace(/\.T$/,'')]||null,supply=evaluateMarginSupply(row,item);
    row.margin_supply=supply;row.supply_label=supply.label;row.supply_score=supply.score;row.margin_ratio=supply.ratio??null;row.margin_buy_balance=supply.buy_balance??null;row.margin_sell_balance=supply.sell_balance??null;row.margin_buy_change_pct=supply.buy_change_pct??null;row.margin_turnover_days=supply.buy_turnover_days??null;row.margin_as_of=supply.as_of??null;row.margin_add_blocked=!!supply.add_blocked;
    row.entry_sort_score=round(Number(row.rs_percentile||0)+clamp(Number(supply.score||0),-20,20)*.5,2);
    if(supply.score>=4&&supply.reasons?.length){const v=`信用需給: ${supply.reasons[0]}`;row.entry_reason=[...new Set([...(row.entry_reason||[]),v])];}
    if(supply.score<=-7||supply.add_blocked){const v=`信用需給: ${(supply.cautions||[])[0]||supply.label}`;row.risk_reason=[...new Set([...(row.risk_reason||[]),v])];}
    if(row.audit)row.audit.margin_supply=supply;
  }
  return rows;
}

export async function enrichRowsWithMargin(env,rows,{force=false}={}){
  try{return enrichMarginSupply(rows,await getMarginDataset(env,{force,fetchIfMissing:force}));}catch(e){for(const r of rows||[])if(r?.market==='jp'){r.margin_supply={available:false,label:'データ待ち',score:0,summary:e?.message||String(e),reasons:[],cautions:[],flags:{},add_blocked:false,position_cap:'normal'};r.supply_label='データ待ち';r.supply_score=0;}return rows;}
}

export async function getMarginDashboard(env,{force=false}={}){
  const data=await getMarginDataset(env,{force}),items=Object.values(data.items||{}),flagged=items.filter(x=>x.flags?.daily_disclosure||x.flags?.special_notice||x.flags?.margin_restriction);
  return{ok:true,schema:data.schema,generated_at:data.generated_at,weekly:data.weekly||null,rules:data.rules||null,count:items.length,flagged_count:flagged.length,stale:!!data.stale,cache_warning:data.cache_warning||null,source:data.source||{},flagged:flagged.slice(0,100).map(x=>({symbol:x.symbol,name:x.name,weekly:x.weekly||null,flags:x.flags||{}}))};
}

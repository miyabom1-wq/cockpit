import { KEYS } from '../storage/kv-schema.js';
import { getStage } from './stage.js';
import { parseJson, nowIso, finite, round } from '../utils.js';
import { ENGINE_VERSION } from '../config.js';

function normalizeStore(raw){
  const v=parseJson(raw,{items:[]});const items=Array.isArray(v)?v:(Array.isArray(v.items)?v.items:[]);
  return{schema:'signal-v5',analyzer_version:ENGINE_VERSION,items:items.map(normalizeItem)};
}
function normalizeItem(x){
  const observations=Array.isArray(x.observations)?x.observations:[];
  if(!observations.length&&x.start_date&&finite(x.start_price))observations.push({date:x.start_date,close:Number(x.start_price),confirmed:true});
  return{...x,market:x.market||((x.symbol||'').endsWith('.T')?'jp':'us'),entry_lane:x.entry_lane||x.lane||'A',active:!!x.active,observations,outcomes:x.outcomes||{},start_price:finite(x.start_price)?Number(x.start_price):finite(observations[0]?.close)?Number(observations[0].close):null};
}
async function read(env){
  const v5=await env.COCKPIT_KV.get(KEYS.signalV5);if(v5)return normalizeStore(v5);
  const v3=await env.COCKPIT_KV.get(KEYS.signalV3);return normalizeStore(v3);
}
async function save(env,s){s.updated_at=nowIso();await env.COCKPIT_KV.put(KEYS.signalV5,JSON.stringify(s));}
function upsertObservation(item,date,close){
  if(!date||!finite(close))return false;item.observations=Array.isArray(item.observations)?item.observations:[];
  const existing=item.observations.find(x=>x.date===date);if(existing){existing.close=Number(close);existing.confirmed=true;return true;}
  item.observations.push({date,close:Number(close),confirmed:true});item.observations.sort((a,b)=>String(a.date).localeCompare(String(b.date)));return true;
}
function compute(item){
  const obs=(item.observations||[]).filter(x=>x.confirmed&&finite(x.close)).sort((a,b)=>String(a.date).localeCompare(String(b.date))),start=finite(item.start_price)?Number(item.start_price):Number(obs[0]?.close);
  if(!(start>0)){item.outcomes={};item.current_return=null;item.observed_days=0;return;}
  const later=obs.filter(x=>x.date>item.start_date),ret=x=>round((Number(x.close)/start-1)*100,2),out={...(item.outcomes||{})};
  if(later[0]&&!out.d1)out.d1={date:later[0].date,close:later[0].close,return_pct:ret(later[0])};
  if(later[2]&&!out.d3)out.d3={date:later[2].date,close:later[2].close,return_pct:ret(later[2])};
  if(later[4]&&!out.d5)out.d5={date:later[4].date,close:later[4].close,return_pct:ret(later[4])};
  item.outcomes=out;item.observed_days=later.length;item.remaining_to_d5=Math.max(0,5-later.length);
  const latest=obs.at(-1);item.latest_date=latest?.date||item.start_date;item.latest_close=latest?.close??start;item.current_return=latest&&latest.date>item.start_date?ret(latest):null;
  const rs=obs.map(ret).filter(finite);item.mfe=rs.length?Math.max(...rs):null;item.mae=rs.length?Math.min(...rs):null;
  item.phase=item.active?'active':out.d5?'complete':'tracking';item.completed_at=out.d5?.date||null;
}
function compactReason(a){return(Array.isArray(a.entry_reason)?a.entry_reason.join(' / '):a.entry_reason)||a.entry_label||'';}
export function shouldIncrementSignalSeen(item,date){return String(item?.last_seen_date||'')!==String(date||'');}

export async function captureSignalLog(env,market='jp',source='auto'){
  const m=market==='us'?'us':'jp',stage=await getStage(env,m);
  if(!stage?.complete)return{ok:false,skipped:true,error:'Stageの完全スナップショットがありません'};
  if(stage.kind!=='confirmed'||!stage.close_verification||Number(stage.close_verification.ratio||0)<90)return{ok:false,skipped:true,error:'確定終値スナップショット待ち'};
  const date=stage.trade_date,stocks=stage.stocks||{},current=Object.values(stocks).filter(x=>['A','B'].includes(x.entry_lane)&&x.data_quality?.data_valid&&x.data_quality?.close_confirmed);
  const store=await read(env),items=store.items;
  for(const item of items.filter(x=>x.market===m&&x.phase!=='complete')){
    const a=stocks[item.symbol];if(a?.data_quality?.data_valid&&a?.data_quality?.close_confirmed&&a.date===date)upsertObservation(item,date,a.price);
  }
  const currentKey=new Set(current.map(x=>`${x.symbol}:${x.entry_lane}`));
  for(const item of items.filter(x=>x.market===m&&x.active)){
    const row=stocks[item.symbol];
    const evaluable=row?.data_quality?.data_valid&&row?.data_quality?.close_confirmed&&row?.date===date;
    if(evaluable&&!currentKey.has(`${item.symbol}:${item.entry_lane}`)){item.active=false;item.condition_end_date=date;item.condition_end_reason='A/B条件から外れた';}
  }
  let added=0,continued=0;
  for(const a of current){
    let item=items.find(x=>x.market===m&&x.symbol===a.symbol&&x.entry_lane===a.entry_lane&&x.active);
    if(item){
      if(shouldIncrementSignalSeen(item,date)){item.times_seen=(item.times_seen||1)+1;continued++;}
      item.last_seen_date=date;item.reason=compactReason(a);item.relative_text=`市場RS5 ${a.rs5??'—'}% / 登録内順位 ${a.rs_percentile??'—'}%`;item.risk_reason=(a.risk_reason||[]).join(' / ');
    }else{
      item={id:`s-${m}-${a.symbol}-${a.entry_lane}-${date}`,symbol:a.symbol,name:a.name,market:m,entry_lane:a.entry_lane,start_date:date,start_price:Number(a.price),active:true,phase:'active',condition_end_date:null,reason:compactReason(a),relative_text:`市場RS5 ${a.rs5??'—'}% / 登録内順位 ${a.rs_percentile??'—'}%`,risk_reason:(a.risk_reason||[]).join(' / '),times_seen:1,last_seen_date:date,source,analyzer_version:ENGINE_VERSION,snapshot_id:stage.snapshot_id,observations:[{date,close:Number(a.price),confirmed:true}],outcomes:{},created_at:nowIso()};items.unshift(item);added++;
    }
  }
  for(const item of items)compute(item);
  store.items=items.slice(0,300);await save(env,store);
  return{ok:true,market:m,date,captured:current.length,added,continued,source,analyzer_version:ENGINE_VERSION,snapshot_id:stage.snapshot_id};
}
export async function syncConfirmedSignalLogs(env,source='auto_read'){
  const results=[];
  for(const market of ['jp','us']){
    try{results.push(await captureSignalLog(env,market,source));}
    catch(error){results.push({ok:false,market,error:error?.message||String(error)});}
  }
  return{ok:true,results};
}
export async function getSignalLog(env,limit=300){
  const store=await read(env),items=store.items.map(x=>{compute(x);return x;}).slice(0,Math.max(1,Math.min(500,Number(limit)||300)));
  const completed=items.filter(x=>finite(x.outcomes?.d5?.return_pct));
  return{ok:true,analyzer_version:ENGINE_VERSION,updated_at:store.updated_at||null,completed_count:completed.length,items};
}
export async function mutateSignalLog(env,body={}){
  const store=await read(env);if(body.action==='delete'){const n=store.items.length;store.items=store.items.filter(x=>x.id!==body.id);await save(env,store);return{ok:true,removed:n-store.items.length};}
  if(body.action==='clear'){store.items=[];await save(env,store);return{ok:true,removed:'all'};}
  return{ok:false,error:'unknown action'};
}

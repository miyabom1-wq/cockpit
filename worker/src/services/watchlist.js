import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso, normalizeSymbol, finite } from '../utils.js';
import { lookupSymbol } from '../data/yahoo.js';
import { analyzeSymbolNow, getStage } from './stage.js';
import { getPositions } from './positions.js';

const VALID_STATUS=new Set(['tracking','waiting','skip']);
function normalizeStatus(value){return VALID_STATUS.has(String(value||''))?String(value):'tracking';}
function snapshotOf(value={}){
  const keys=['symbol','name','market','date','price','change_pct','price_time','entry_lane','entry_label','entry_quality','effective_vol_ratio','vol_ratio','div25','rs5','rs20','long_stage','stage','stage_code','setup_label','snapshot_id'];
  const out={};for(const k of keys)if(value?.[k]!=null)out[k]=value[k];return Object.keys(out).length?out:null;
}
function normalizeItem(item={}){
  const legacyStatus=VALID_STATUS.has(String(item.status||''))?null:String(item.status||'');
  return{...item,status:normalizeStatus(item.status),legacy_status:legacyStatus||item.legacy_status||null,signal_at:item.signal_at||item.added_at||null,signal_snapshot:item.signal_snapshot||null};
}
async function read(env){
  const v=parseJson(await env.COCKPIT_KV.get(KEYS.watch),[]),raw=Array.isArray(v)?v:[],list=raw.map(normalizeItem);
  const changed=raw.some((x,i)=>JSON.stringify(x)!==JSON.stringify(list[i]));if(changed)await save(env,list);return list;
}
async function save(env,list){await env.COCKPIT_KV.put(KEYS.watch,JSON.stringify(list));}
function dataTime(x){return Math.max(Date.parse(x?.price_time||0)||0,Date.parse(x?.updated_at||0)||0,Date.parse(x?.date?`${x.date}T23:59:59Z`:0)||0);}
function newer(a,b){return dataTime(a)>=dataTime(b)?a:b;}
export async function getWatchlist(env){
  const list=await read(env),[jp,us,pos]=await Promise.all([getStage(env,'jp'),getStage(env,'us'),getPositions(env)]),held=new Set((pos.positions||[]).map(x=>x.symbol));
  return{ok:true,items:list.map(w=>{const stage=(w.market==='us'?us:jp)?.stocks?.[w.symbol]||null,latest=w.stage_data&&stage?newer(w.stage_data,stage):w.stage_data||stage||{};return{...w,held:held.has(w.symbol),current_data:latest,stage_data:latest,status:normalizeStatus(w.status)};})};
}
export async function mutateWatchlist(env,body={}){
  const action=body.action||'get',list=await read(env);
  if(action==='resolve_name'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market),q=await lookupSymbol(symbol);return{ok:true,symbol:q?.symbol||symbol,name:q?.name||symbol};
  }
  if(action==='add'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market);if(!symbol)return{ok:false,error:'symbol required'};
    const existing=list.find(x=>x.symbol===symbol);if(existing)return{ok:true,added:false,item:existing};
    const signalSnapshot=snapshotOf(body.signal_snapshot||{}),item={id:`w${Date.now()}${Math.random().toString(36).slice(2,5)}`,symbol,name:String(body.name||symbol).slice(0,80),market,status:normalizeStatus(body.status),memo:String(body.memo||'').slice(0,500),source:String(body.source||'manual'),added_at:nowIso(),updated_at:nowIso(),signal_at:String(body.signal_at||signalSnapshot?.price_time||'')||nowIso(),signal_snapshot:signalSnapshot,stage_data:null};list.push(item);await save(env,list);return{ok:true,added:true,item};
  }
  const i=list.findIndex(x=>String(x.id)===String(body.id));if(i<0)return{ok:false,error:'not found'};
  if(action==='update'){if(body.status!=null)list[i].status=normalizeStatus(body.status);if(body.memo!=null)list[i].memo=String(body.memo).slice(0,500);list[i].updated_at=nowIso();await save(env,list);return{ok:true,item:list[i]};}
  if(action==='delete'){const [removed]=list.splice(i,1);await save(env,list);return{ok:true,removed};}
  if(action==='refresh_stage'){
    const w=list[i],a=await analyzeSymbolNow(env,w.symbol,w.name,w.market);if(!a)return{ok:false,error:'再判定できませんでした'};a.updated_at=nowIso();w.stage_data=a;w.stage_refreshed_at=nowIso();w.stage_refresh_note=`${a.close_confirmed?'確定終値':'場中暫定'} / ${a.data_quality?.data_valid?'データ有効':'要確認'} / ${a.date||'—'}`;w.updated_at=nowIso();await save(env,list);return{ok:true,item:w,analysis:a};
  }
  return{ok:false,error:'unknown action'};
}

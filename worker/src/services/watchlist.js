import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso, normalizeSymbol } from '../utils.js';
import { lookupSymbol } from '../data/yahoo.js';
import { analyzeSymbolNow, getStage } from './stage.js';
import { getPositions } from './positions.js';
async function read(env){const v=parseJson(await env.COCKPIT_KV.get(KEYS.watch),[]);return Array.isArray(v)?v:[];}
async function save(env,list){await env.COCKPIT_KV.put(KEYS.watch,JSON.stringify(list));}
function newer(a,b){return new Date(a?.updated_at||a?.price_time||0).getTime()>=new Date(b?.updated_at||b?.price_time||0).getTime()?a:b;}
export async function getWatchlist(env){
  const list=await read(env),[jp,us,pos]=await Promise.all([getStage(env,'jp'),getStage(env,'us'),getPositions(env)]),held=new Set((pos.positions||[]).map(x=>x.symbol));
  return{ok:true,items:list.map(w=>{const stage=(w.market==='us'?us:jp)?.stocks?.[w.symbol]||null,latest=w.stage_data&&stage?newer(w.stage_data,stage):w.stage_data||stage||{};return{...w,held:held.has(w.symbol),stage_data:latest};})};
}
export async function mutateWatchlist(env,body={}){
  const action=body.action||'get',list=await read(env);
  if(action==='resolve_name'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market),q=await lookupSymbol(symbol);return{ok:true,symbol:q?.symbol||symbol,name:q?.name||symbol};
  }
  if(action==='add'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market);if(!symbol)return{ok:false,error:'symbol required'};
    const existing=list.find(x=>x.symbol===symbol);if(existing)return{ok:true,added:false,item:existing};
    const item={id:`w${Date.now()}${Math.random().toString(36).slice(2,5)}`,symbol,name:String(body.name||symbol).slice(0,80),market,status:'tracking',memo:String(body.memo||'').slice(0,500),source:String(body.source||'manual'),added_at:nowIso(),updated_at:nowIso(),stage_data:null};list.push(item);await save(env,list);return{ok:true,added:true,item};
  }
  const i=list.findIndex(x=>String(x.id)===String(body.id));if(i<0)return{ok:false,error:'not found'};
  if(action==='update'){if(body.status!=null)list[i].status=String(body.status);if(body.memo!=null)list[i].memo=String(body.memo).slice(0,500);list[i].updated_at=nowIso();await save(env,list);return{ok:true,item:list[i]};}
  if(action==='delete'){const [removed]=list.splice(i,1);await save(env,list);return{ok:true,removed};}
  if(action==='refresh_stage'){
    const w=list[i],a=await analyzeSymbolNow(env,w.symbol,w.name,w.market);if(!a)return{ok:false,error:'再判定できませんでした'};a.updated_at=nowIso();w.stage_data=a;w.stage_refresh_note=`${a.close_confirmed?'確定終値':'場中暫定'} / ${a.data_quality?.data_valid?'データ有効':'要確認'} / ${a.date||'—'}`;w.updated_at=nowIso();await save(env,list);return{ok:true,item:w,analysis:a};
  }
  return{ok:false,error:'unknown action'};
}

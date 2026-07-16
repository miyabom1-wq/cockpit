import { DEFAULT_STOCKS, LIMITS } from '../config.js';
import { KEYS } from './kv-schema.js';
import { normalizeSymbol, parseJson, nowIso } from '../utils.js';
function maxFor(m){return m==='jp'?LIMITS.jpMax:LIMITS.usMax;}
export function focusTier(market,index){
  if(market==='jp')return index<LIMITS.jpCore?'core':'radar';
  return index<LIMITS.usLead?'lead':'archive';
}
export async function getStockList(env,market){
  const m=market==='us'?'us':'jp',raw=await env.COCKPIT_KV.get(KEYS.stocklist(m));
  if(raw){const x=parseJson(raw,[]);if(Array.isArray(x))return x.map((it,i)=>({...it,focus_tier:focusTier(m,i)}));}
  const list=Object.entries(DEFAULT_STOCKS[m]).map(([symbol,name],i)=>({symbol,name,added_at:nowIso(),focus_tier:focusTier(m,i)}));
  await env.COCKPIT_KV.put(KEYS.stocklist(m),JSON.stringify(list.map(({focus_tier,...x})=>x)));return list;
}
async function save(env,market,list){await env.COCKPIT_KV.put(KEYS.stocklist(market),JSON.stringify(list.map(({focus_tier,...x})=>x)));}
export async function handleStockListAction(env,market,body={}){
  const m=market==='us'?'us':'jp',action=body.action||'get';let list=await getStockList(env,m);list=list.map(({focus_tier,...x})=>x);
  if(action==='get')return{ok:true,market:m,count:list.length,max:maxFor(m),active_limit:m==='jp'?LIMITS.jpMax:LIMITS.usLead,core_limit:m==='jp'?LIMITS.jpCore:LIMITS.usLead,list:list.map((x,i)=>({...x,focus_tier:focusTier(m,i)}))};
  if(action==='add'){
    const symbol=normalizeSymbol(body.symbol,m),name=String(body.name||symbol).trim().slice(0,80);if(!symbol)return{ok:false,error:'symbol required'};
    if(list.some(x=>x.symbol===symbol))return{ok:false,error:'既に登録済み',added:false};if(list.length>=maxFor(m))return{ok:false,error:`上限${maxFor(m)}銘柄`,added:false};
    list.push({symbol,name,added_at:nowIso()});await save(env,m,list);return{ok:true,added:true,item:{...list.at(-1),focus_tier:focusTier(m,list.length-1)},count:list.length};
  }
  if(action==='batch_add'){
    const added=[],skipped=[];for(const it of Array.isArray(body.items)?body.items:[]){const symbol=normalizeSymbol(it.symbol,m);if(!symbol||list.some(x=>x.symbol===symbol)){skipped.push({symbol,reason:'登録済みまたは形式不正'});continue;}if(list.length>=maxFor(m)){skipped.push({symbol,reason:'上限到達'});continue;}const item={symbol,name:String(it.name||symbol).slice(0,80),added_at:nowIso()};list.push(item);added.push(item);}
    if(added.length)await save(env,m,list);return{ok:true,added,skipped,count:list.length};
  }
  if(action==='delete'){
    const symbol=normalizeSymbol(body.symbol,m),before=list.length;list=list.filter(x=>x.symbol!==symbol);if(list.length!==before)await save(env,m,list);return{ok:true,removed:before-list.length,count:list.length};
  }
  if(action==='promote'){
    const symbol=normalizeSymbol(body.symbol,m),idx=list.findIndex(x=>x.symbol===symbol);if(idx<0)return{ok:false,error:'not found'};const boundary=m==='jp'?LIMITS.jpCore:LIMITS.usLead;const [it]=list.splice(idx,1);list.splice(Math.min(boundary-1,list.length),0,it);await save(env,m,list);return{ok:true,count:list.length};
  }
  if(action==='demote'){
    const symbol=normalizeSymbol(body.symbol,m),idx=list.findIndex(x=>x.symbol===symbol);if(idx<0)return{ok:false,error:'not found'};const boundary=m==='jp'?LIMITS.jpCore:LIMITS.usLead;const [it]=list.splice(idx,1);list.splice(Math.min(boundary,list.length),0,it);await save(env,m,list);return{ok:true,count:list.length};
  }
  if(action==='replace'){
    const next=[];for(const it of Array.isArray(body.items)?body.items:[]){const symbol=normalizeSymbol(it.symbol,m);if(symbol&&!next.some(x=>x.symbol===symbol)&&next.length<maxFor(m))next.push({symbol,name:String(it.name||symbol).slice(0,80),added_at:it.added_at||nowIso()});}
    await save(env,m,next);return{ok:true,count:next.length};
  }
  return{ok:false,error:'unknown action'};
}

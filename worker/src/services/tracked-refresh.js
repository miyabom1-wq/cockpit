import { KEYS } from '../storage/kv-schema.js';
import { getStockList } from '../storage/stocklist.js';
import { parseJson } from '../utils.js';
import { expectedConfirmedTradingDate } from '../data/calendar.js';
import { getStage, analyzeRegisteredSymbolNow } from './stage.js';
import { backgroundCapacity } from '../storage/write-budget.js';
import { TRACKED_KEY, getTrackedData, latestAnalysis, assessedRow } from './tracked-data.js';

// Bounded idle work covers watch/held symbols outside the active candidate pool.
export async function refreshTrackedAnalysis(env){
  if(!await backgroundCapacity(env,20))return {skipped:true,reason:'price_reserve'};
  const [watch,positions,jp,us,jpList,usList,cache]=await Promise.all([
    env.COCKPIT_KV.get(KEYS.watch),env.COCKPIT_KV.get(KEYS.discipline),getStage(env,'jp'),getStage(env,'us'),getStockList(env,'jp'),getStockList(env,'us'),getTrackedData(env)
  ]);
  const seen=new Set(),items=[...parseJson(watch,[]),...(parseJson(positions,{}).positions||[]),...jpList.map(x=>({...x,market:'jp'})),...usList.map(x=>({...x,market:'us'}))];
  for(const item of items){
    const market=item.market||((item.symbol||'').endsWith('.T')?'jp':'us'),id=market+':'+item.symbol;
    if(!item.symbol||seen.has(id))continue;seen.add(id);
    const stage=(market==='jp'?jp:us).stocks?.[item.symbol];
    if(stage?.assessment_usable!==false&&stage?.momentumState)continue;
    const old=cache[id]||{},selected=latestAnalysis(stage,old.row,item.stage_data),row=assessedRow(selected,market);
    if(row.assessment_usable&&row.close_confirmed&&row.date>=expectedConfirmedTradingDate(market))continue;
    const marker='sched:tracked-retry:'+id;
    if(await env.COCKPIT_KV.get(marker))continue;
    const at=new Date().toISOString();
    try{
      const analysis=await analyzeRegisteredSymbolNow(env,item.symbol,item.name||item.symbol,market,{refresh:true});
      const next=assessedRow(analysis||{},market);
      const good=next.assessment_usable;
      cache[id]={row:good?next:selected,last_attempt_at:at,last_success_at:good?at:old.last_success_at||null,status:good?'CURRENT':next.data_status,last_error:good?null:'取得データの鮮度・分析条件を満たしていません',retry_eligible:!good};
      await env.COCKPIT_KV.put(TRACKED_KEY,JSON.stringify(cache));
      await env.COCKPIT_KV.put(marker,at,{expirationTtl:good?3600:1800});
      return {processed:1,symbol:item.symbol,status:cache[id].status};
    }catch(error){
      cache[id]={...old,row:selected,last_attempt_at:at,status:'FAILED',last_error:String(error?.message||error).slice(0,240),retry_eligible:true};
      await env.COCKPIT_KV.put(TRACKED_KEY,JSON.stringify(cache));
      await env.COCKPIT_KV.put(marker,at,{expirationTtl:1800});
      return {processed:1,symbol:item.symbol,status:'FAILED'};
    }
  }
  return {skipped:true,reason:'tracked_data_current'};
}

import { getTrackedData, latestAnalysis, assessedRow } from './tracked-data.js';
import { readBacktestRuntime } from './backtest-runtime.js';
import { ENGINE_VERSION, BUILD_ID, BACKTEST_VERSION } from '../config.js';
import { marginFreshness } from './margin-supply.js';
import { expectedConfirmedTradingDate } from '../data/calendar.js';
import { stageFreshness } from './stage-freshness.js';
import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso } from '../utils.js';

const MAX_NODE_ERRORS = 24;
function domain(node){return [node.market||'',node.action||node.key,node.kind||'',node.part||''].join(':');}
function nodeMeta(node){return {domain:domain(node),trade_date:node.tradeDate||null};}

function trimErrors(errors={}){
  return Object.fromEntries(
    Object.entries(errors)
      .sort((a,b)=>String(b[1]?.at||'').localeCompare(String(a[1]?.at||'')))
      .slice(0,MAX_NODE_ERRORS)
  );
}

export async function getSchedulerHealth(env){
  return parseJson(await env.COCKPIT_KV.get(KEYS.schedulerHealth),{
    schema:'scheduler-health-v1',
    last_cron_at:null,
    last_success_at:null,
    last_error_at:null,
    last_node:null,
    last_error:null,
    node_errors:{},
    counters:{runs:0,successes:0,failures:0,retries:0},
  });
}

async function save(env,next){
  next.schema='scheduler-health-v1';
  next.node_errors=trimErrors(next.node_errors||{});
  const latest=Object.values(next.node_errors).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
  next.last_error=latest?.error||null;
  await env.COCKPIT_KV.put(KEYS.schedulerHealth,JSON.stringify(next));
  return next;
}

export async function recordCronHeartbeat(env,details={}){
  const current=await getSchedulerHealth(env);
  // Ten-minute persisted heartbeat stays within the 15-minute health window.
  // runs counts persisted heartbeat samples, not every five-minute invocation.
  if(Date.now()-Date.parse(current.last_cron_at||'')<600000)return current;
  return save(env,{
    ...current,
    last_cron_at:nowIso(),
    last_cron_details:details,
    counters:{...current.counters,runs:Number(current.counters?.runs||0)+1},
  });
}

export async function recordSchedulerSuccess(env,node,details={}){
  const current=await getSchedulerHealth(env);
  const errors={...(current.node_errors||{})};
  delete errors[node.key];
  for(const [key,error] of Object.entries(errors)){
    if(error.domain===domain(node)&&(!error.trade_date||error.trade_date<=node.tradeDate))delete errors[key];
  }
  return save(env,{
    ...current,
    last_success_at:nowIso(),
    last_node:node.key,
    last_error:null,
    node_errors:errors,
    last_result:details,
    counters:{...current.counters,successes:Number(current.counters?.successes||0)+1},
  });
}

export async function recordSchedulerRetry(env,node,details={}){
  const current=await getSchedulerHealth(env);
  const at=nowIso();
  return save(env,{
    ...current,
    last_error_at:at,
    last_node:node.key,
    last_error:details?.error||'retry required',
    node_errors:{...(current.node_errors||{}),[node.key]:{at,type:'retry',...details,...nodeMeta(node)}},
    counters:{...current.counters,retries:Number(current.counters?.retries||0)+1},
  });
}

export async function recordSchedulerFailure(env,node,error){
  const current=await getSchedulerHealth(env);
  const at=nowIso(),message=error?.message||String(error);
  return save(env,{
    ...current,
    last_error_at:at,
    last_node:node.key,
    last_error:message,
    node_errors:{...(current.node_errors||{}),[node.key]:{at,type:'error',error:message,...nodeMeta(node)}},
    counters:{...current.counters,failures:Number(current.counters?.failures||0)+1},
  });
}

function stageSummary(stage){
  const updated=stage?.updated_at?Date.parse(stage.updated_at):NaN;
  return{
    market:stage?.market||null,
    trade_date:stage?.trade_date||null,
    kind:stage?.kind||null,
    complete:Boolean(stage?.complete),
    producer_build:stage?.build||null,
    producer_engine:stage?.engine_version||null,
    expected_engine:ENGINE_VERSION,
    momentum_count:Object.values(stage?.stocks||{}).filter(r=>r.momentumState).length,
    total_count:Object.keys(stage?.stocks||{}).length,
    confirmed_ratio:Number(stage?.close_verification?.ratio||0),
    updated_at:stage?.updated_at||null,
    age_minutes:Number.isFinite(updated)?Math.max(0,Math.round((Date.now()-updated)/60000)):null,
    snapshot_id:stage?.snapshot_id||null,
    ...stageFreshness(stage),
  };
}

export async function getSystemAudit(env){
  const [scheduler,jpRaw,usRaw]=await Promise.all([
    getSchedulerHealth(env),
    env.COCKPIT_KV.get(KEYS.stage('jp')),
    env.COCKPIT_KV.get(KEYS.stage('us')),
  ]);
  const specifications=[['ranking_jp',KEYS.ranking('jp')],['ranking_us',KEYS.ranking('us')],['earnings_jp','events:jpx:v1'],['earnings_us','events:us-calendar:v1'],['margin',KEYS.marginSupply]];
  const datasets=Object.fromEntries(await Promise.all(specifications.map(async([name,key])=>{
    const cached=parseJson(await env.COCKPIT_KV.get(key),null),data=cached?.dataset||cached;
    const status=name.startsWith('ranking_')?parseJson(await env.COCKPIT_KV.get('ranking:status:'+name.slice(-2)),{}):{};
    const updated=data?.updated_at||data?.generated_at||null,age=updated?(Date.now()-Date.parse(updated))/3600000:Infinity;
    const market=name.endsWith('_us')?'us':'jp';
    const stale=name.startsWith('ranking_')?(!data?.trade_date||data.trade_date<expectedConfirmedTradingDate(market)):(name==='margin'?marginFreshness(data).stale:age>4*24);
    return[name,{updated_at:updated,trade_date:data?.trade_date||data?.daily?.as_of||data?.weekly?.as_of||null,available:!!data,stale,last_error:status.last_error||null,last_error_at:status.last_error_at||null}];
  })));
  const jp=stageSummary(parseJson(jpRaw,{market:'jp'}));
  const us=stageSummary(parseJson(usRaw,{market:'us'}));
  const bt=parseJson(await env.COCKPIT_KV.get(`backtest:${BACKTEST_VERSION}:state`),null);
  const runtime=await readBacktestRuntime(env,bt?.status,bt?.updated_at);
  const [watchRaw,positionsRaw,tracked]=await Promise.all([env.COCKPIT_KV.get(KEYS.watch),env.COCKPIT_KV.get(KEYS.discipline),getTrackedData(env)]);
  const monitored=[...parseJson(watchRaw,[]),...(parseJson(positionsRaw,{}).positions||[])];
  const stages={jp:parseJson(jpRaw,{}),us:parseJson(usRaw,{})};
  const unusable=monitored.filter(w=>{const market=w.market||((w.symbol||'').endsWith('.T')?'jp':'us');return !assessedRow(latestAnalysis(stages[market].stocks?.[w.symbol],tracked[market+':'+w.symbol]?.row,w.stage_data),market).assessment_usable;});
  const rows=Object.values(stages).flatMap(s=>Object.values(s.stocks||{}));
  const components={
    watch_data:unusable.length?'STALE':'CURRENT',
    extension_engine:rows.length&&rows.every(r=>r.extensionState&&r.extensionState!=='unknown')?'CURRENT':'INCOMPLETE',
    position_decision:rows.length&&rows.every(r=>r.entryAssessment&&r.holdingAssessment)?'CURRENT':'INCOMPLETE',
    market_data:[jp,us].every(s=>!s.is_stale)?'CURRENT':'STALE',
    momentum_engine:[jp,us].every(s=>!s.schema_mismatch)?'CURRENT':'SCHEMA_MISMATCH',
    credit:datasets.margin.available?(datasets.margin.stale?'STALE':'CURRENT'):'MISSING',
    backtest:!bt?'MISSING':runtime.status,
    storage:'READ_OK'
  };
  const cronAt=scheduler.last_cron_at?Date.parse(scheduler.last_cron_at):NaN;
  const cronAge=Number.isFinite(cronAt)?Math.max(0,Math.round((Date.now()-cronAt)/60000)):null;
  return{
    ok:components.market_data==='CURRENT'&&components.momentum_engine==='CURRENT'&&components.credit==='CURRENT'&&components.watch_data==='CURRENT'&&components.extension_engine==='CURRENT'&&components.position_decision==='CURRENT'&&['RUNNING','COMPLETE'].includes(components.backtest)&&cronAge!==null&&cronAge<=15,
    components,tracked_health:{unusable_count:unusable.length,checked_count:monitored.length},reader_build:BUILD_ID,
    backtest:{...runtime,status:components.backtest,last_attempt_at:bt?.updated_at||null,last_success_at:bt?.last_success_at||null,last_processed:bt?.last_processed||null,processed_count:bt?.cursor||0,remaining_count:Math.max(0,(bt?.queue?.length||0)-(bt?.cursor||0))+(bt?.retry_queue?.length||0),total_count:bt?.queue?.length||0,retry_count:(bt?.errors||[]).length,last_error:runtime.last_error||bt?.errors?.at(-1)||null},
    checked_at:nowIso(),
    scheduler:{...scheduler,age_minutes:cronAge,alive:cronAge!==null&&cronAge<=15},
    stages:{jp,us},datasets,
  };
}

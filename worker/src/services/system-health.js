import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso } from '../utils.js';

const MAX_NODE_ERRORS = 24;

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
  await env.COCKPIT_KV.put(KEYS.schedulerHealth,JSON.stringify(next));
  return next;
}

export async function recordCronHeartbeat(env,details={}){
  const current=await getSchedulerHealth(env);
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
    node_errors:{...(current.node_errors||{}),[node.key]:{at,type:'retry',...details}},
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
    node_errors:{...(current.node_errors||{}),[node.key]:{at,type:'error',error:message}},
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
    confirmed_ratio:Number(stage?.close_verification?.ratio||0),
    updated_at:stage?.updated_at||null,
    age_minutes:Number.isFinite(updated)?Math.max(0,Math.round((Date.now()-updated)/60000)):null,
    snapshot_id:stage?.snapshot_id||null,
  };
}

export async function getSystemAudit(env){
  const [scheduler,jpRaw,usRaw]=await Promise.all([
    getSchedulerHealth(env),
    env.COCKPIT_KV.get(KEYS.stage('jp')),
    env.COCKPIT_KV.get(KEYS.stage('us')),
  ]);
  const jp=stageSummary(parseJson(jpRaw,{market:'jp'}));
  const us=stageSummary(parseJson(usRaw,{market:'us'}));
  const cronAt=scheduler.last_cron_at?Date.parse(scheduler.last_cron_at):NaN;
  const cronAge=Number.isFinite(cronAt)?Math.max(0,Math.round((Date.now()-cronAt)/60000)):null;
  return{
    ok:true,
    checked_at:nowIso(),
    scheduler:{...scheduler,age_minutes:cronAge,alive:cronAge!==null&&cronAge<=15},
    stages:{jp,us},
  };
}

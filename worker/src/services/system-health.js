const KEY='system:scheduler:v1';

function parse(value){
 try{return value?JSON.parse(value):{}}
 catch{return{}}
}
export async function getSchedulerHealth(env){
 return parse(await env.COCKPIT_KV.get(KEY));
}
export async function updateSchedulerHealth(env,patch={}){
 const current=await getSchedulerHealth(env);
 const next={...current,...patch};
 if(patch.jobs===undefined&&current.jobs)next.jobs=current.jobs;
 await env.COCKPIT_KV.put(KEY,JSON.stringify(next),{expirationTtl:604800});
 return next;
}
export async function recordSchedulerJob(env,node,status,error=null){
 const current=await getSchedulerHealth(env);
 const jobs={...(current.jobs||{})};
 const key=String(node?.key||node?.action||'unknown');
 const previous=jobs[key]||{};
 const now=new Date().toISOString();
 jobs[key]={
  key,
  action:node?.action||'stage',
  market:node?.market||null,
  trade_date:node?.tradeDate||null,
  status,
  last_at:now,
  last_success_at:status==='ok'?now:(previous.last_success_at||null),
  failures:status==='error'?Number(previous.failures||0)+1:0,
  error:error?String(error?.message||error).slice(0,500):null
 };
 const entries=Object.entries(jobs)
  .sort((a,b)=>String(b[1]?.last_at||'').localeCompare(String(a[1]?.last_at||'')))
  .slice(0,50);
 return updateSchedulerHealth(env,{jobs:Object.fromEntries(entries)});
}

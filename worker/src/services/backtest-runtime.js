import { parseJson } from '../utils.js';
export const BACKTEST_RUNTIME_KEY='sched:backtest-runtime:v1';
export async function readBacktestRuntime(env,status,lastAttempt){
  const runtime=parseJson(await env.COCKPIT_KV.get(BACKTEST_RUNTIME_KEY),{});
  if(['complete','failed'].includes(status))return {...runtime,status:status.toUpperCase()};
  const now=Date.now();
  if(runtime.status==='PAUSED_BUDGET'&&Date.parse(runtime.next_retry_at)>now)return runtime;
  if(runtime.status==='FAILED'&&Date.parse(runtime.updated_at)>=Date.parse(lastAttempt||0))return runtime;
  const stopped=!lastAttempt||now-Date.parse(lastAttempt)>30*60000;
  return {...runtime,status:stopped?'STOPPED':'RUNNING',reason:stopped?'進捗が30分以上更新されていません':null};
}

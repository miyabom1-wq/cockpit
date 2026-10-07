import { budgetStatus, scopedStorage } from '../storage/write-budget.js';
import { runBacktestStep } from './backtest.js';
import { BACKTEST_RUNTIME_KEY } from './backtest-runtime.js';

// Automatic backtests share the 100-write analysis lane, never the price reserve.
// One step needs at most 10 writes including a cold benchmark and finalization.
export async function runScheduledBacktest(rawEnv){
  const scope=scopedStorage(rawEnv,'analysis'),env=scope.env;
  const record=state=>env.COCKPIT_KV.put(BACKTEST_RUNTIME_KEY,JSON.stringify({...state,updated_at:new Date().toISOString()}),{expirationTtl:172800});
  try{
    const budget=await budgetStatus(env);
    if(budget.limits.analysis-(budget.used.analysis||0)<12){
      await record({status:'PAUSED_BUDGET',reason:'分析用の本日分保存予算を使用しました。価格更新用の予算は維持します。',next_retry_at:budget.reset_at,retry_eligible:true});
      return {skipped:true,reason:'analysis_budget'};
    }
    await record({status:'PROCESSING',last_attempt_at:new Date().toISOString(),retry_eligible:true});
    const result=await runBacktestStep(env,1,false,{scheduled:true});
    await record({status:result.paused?'FAILED':String(result.status||'running').toUpperCase(),reason:result.paused_reason||result.reason||null,last_success_at:result.last_success_at||null,last_error:result.last_error||null,next_retry_at:new Date(Date.now()+15*60000).toISOString(),retry_eligible:!['complete','failed'].includes(result.status)});
    return result;
  }catch(error){
    await record({status:'FAILED',reason:String(error?.message||error).slice(0,240),last_error:String(error?.code||error?.message||error).slice(0,240),next_retry_at:new Date(Date.now()+15*60000).toISOString(),retry_eligible:true});
    return {skipped:true,reason:'backtest_failure'};
  }finally{await scope.finish();}
}

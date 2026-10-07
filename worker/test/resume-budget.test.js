import {refreshTrackedAnalysis} from '../src/services/tracked-refresh.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetTestEnv} from './budget-fixture.js';
import {syntheticRows,yahooResult} from './helpers.js';
import {runScheduledBacktest} from '../src/services/backtest-scheduler.js';
import {getBacktestDashboard} from '../src/services/backtest.js';
import {scopedStorage,budgetStatus} from '../src/storage/write-budget.js';
import {BACKTEST_VERSION,ENGINE_VERSION} from '../src/config.js';
import {getWatchlist} from '../src/services/watchlist.js';
import {getSystemAudit} from '../src/services/system-health.js';
import {TRACKED_KEY} from '../src/services/tracked-data.js';
import {KEYS} from '../src/storage/kv-schema.js';

test('144-symbol backtest resumes across daily budgets even with price budget exhausted',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-06T01:00:00Z')});
 const env=budgetTestEnv();
 env.COCKPIT_KV.map.set('stocklist:jp',JSON.stringify(Array.from({length:104},(_,i)=>({symbol:`${2000+i}.T`,name:'JP'}))));
 env.COCKPIT_KV.map.set('stocklist:us',JSON.stringify(Array.from({length:40},(_,i)=>({symbol:`US${i}`,name:'US'}))));
 const fill=scopedStorage(env,'background');for(let i=0;i<350;i++)await fill.env.COCKPIT_KV.put('price-test',String(i));await fill.finish();
 const rows=syntheticRows(270,'2026-10-02');
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(String(input)),symbol=decodeURIComponent(u.pathname.split('/').at(-1));
  return Response.json({chart:{result:[yahooResult(rows,symbol)],error:null}});
 });
 let pauses=0,complete=false,last=0;
 for(let i=0;i<96*7;i++){
  const step=await runScheduledBacktest(env);
  if(step.reason==='analysis_budget')pauses++;
  const read=scopedStorage(env,'read');const report=await getBacktestDashboard(read.env);await read.finish();
  assert.ok(report.progress.attempted>=last);last=report.progress.attempted;
  const budget=await budgetStatus(env);assert.ok(Object.values(budget.used).reduce((a,b)=>a+b,0)<=500);
  if(report.status==='complete'){assert.equal(report.progress.success,144);complete=true;break;}
  t.mock.timers.tick(15*60000);
 }
 assert.ok(pauses>0);assert.equal(complete,true);assert.equal(last,144);
 t.diagnostic(`144 completed at ${new Date().toISOString()}, budget pauses=${pauses}`);
});

test('tracked fresh analysis replaces old same-day watch snapshot missing engine version',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-06T10:00:00Z')});
 const env=budgetTestEnv(),row={symbol:'MSTR',market:'us',date:'2026-10-05',price:300,engine_version:ENGINE_VERSION,momentumState:'continuation'};
 env.COCKPIT_KV.map.set(KEYS.watch,JSON.stringify([{symbol:'MSTR',market:'us',stage_data:{...row,engine_version:null,price:290}}]));
 env.COCKPIT_KV.map.set(TRACKED_KEY,JSON.stringify({'us:MSTR':{row,status:'CURRENT'}}));
 const result=await getWatchlist(env);assert.equal(result.items[0].current_data.price,300);assert.equal(result.items[0].current_data.assessment_usable,true);
});

test('health cannot be OK while backtest is stopped',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-06T10:00:00Z')});
 const env=budgetTestEnv();
 env.COCKPIT_KV.map.set(`backtest:${BACKTEST_VERSION}:state`,JSON.stringify({status:'running',cursor:31,queue:Array(144).fill({}),updated_at:'2026-10-06T08:00:00Z'}));
 for(const [m,date] of [['jp','2026-10-06'],['us','2026-10-05']])env.COCKPIT_KV.map.set(KEYS.stage(m),JSON.stringify({market:m,complete:true,trade_date:date,kind:'confirmed',close_verification:{ratio:100},engine_version:ENGINE_VERSION,stocks:{TEST:{engine_version:ENGINE_VERSION,momentumState:'continuation',extensionState:'normal',entryAssessment:'CANDIDATE',holdingAssessment:'HOLD'}}}));
 env.COCKPIT_KV.map.set(KEYS.marginSupply,JSON.stringify({schema:'jp-margin-v2',daily:{as_of:'2026-10-05'}}));
 env.COCKPIT_KV.map.set(KEYS.schedulerHealth,JSON.stringify({last_cron_at:new Date().toISOString()}));
 const report=await getSystemAudit(env);assert.equal(report.components.market_data,'CURRENT');assert.equal(report.components.credit,'CURRENT');assert.equal(report.components.momentum_engine,'CURRENT');assert.equal(report.components.backtest,'STOPPED');assert.equal(report.ok,false);assert.equal(report.backtest.remaining_count,113);
});

test('idle refresh updates watched MSTR outside active universe and persists success',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-06T10:00:00Z')});
 const env=budgetTestEnv();
 env.COCKPIT_KV.map.set('stocklist:jp','[]');env.COCKPIT_KV.map.set('stocklist:us','[]');
 env.COCKPIT_KV.map.set(KEYS.watch,JSON.stringify([{symbol:'MSTR',market:'us',name:'Strategy',stage_data:{date:'2026-09-18',price:132}}]));
 const rows=syntheticRows(300,'2026-10-05');
 t.mock.method(globalThis,'fetch',async input=>Response.json({chart:{result:[yahooResult(rows,decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1)))],error:null}}));
 const scope=scopedStorage(env,'background');const result=await refreshTrackedAnalysis(scope.env);await scope.finish();
 assert.equal(result.symbol,'MSTR');assert.equal(result.status,'CURRENT');
 const watch=await getWatchlist(env);assert.equal(watch.items[0].current_data.date,'2026-10-05');assert.equal(watch.items[0].current_data.assessment_usable,true);
 const second=scopedStorage(env,'background');assert.equal((await refreshTrackedAnalysis(second.env)).skipped,true);await second.finish();
});

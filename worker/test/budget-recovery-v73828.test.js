import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {budgetTestEnv} from './budget-fixture.js';
import {scopedStorage,budgetStatus} from '../src/storage/write-budget.js';
import {remainingMacroWrites,updateCapacity} from '../src/services/update-capacity.js';
import {refreshTrackedAnalysis} from '../src/services/tracked-refresh.js';
import {TRACKED_KEY} from '../src/services/tracked-data.js';
import {confirmedByProvider} from '../src/services/stage.js';
import {macroFreshness,MACRO_STATUS_KEY} from '../src/services/macro-freshness.js';
import {KEYS} from '../src/storage/kv-schema.js';
import {ENGINE_VERSION,MARKET_INDICES} from '../src/config.js';
import {syntheticRows,yahooResult} from './helpers.js';

async function tick(env){let task;await worker.scheduled({cron:'*/5 * * * *',scheduledTime:Date.now()},env,{waitUntil:p=>task=p});await task;}
async function fill(env,count){const scope=scopedStorage(env,'background');for(let i=0;i<count;i++)await scope.env.COCKPIT_KV.put('test-used',String(i));await scope.finish();}

test('real failure: 291 used writes still publishes US close and refreshes watched symbol before UTC reset',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-15T22:05:00Z')});
 const env=budgetTestEnv(),kv=env.COCKPIT_KV;await fill(env,291);
 kv.map.set(KEYS.schema,'vantage-kv-v3');kv.map.set(KEYS.stocklist('jp'),'[]');
 kv.map.set(KEYS.stocklist('us'),JSON.stringify(Array.from({length:40},(_,i)=>({symbol:'US'+i,name:'US'}))));
 kv.map.set(KEYS.watch,JSON.stringify([{symbol:'MSTR',market:'us',name:'Strategy',stage_data:{date:'2026-10-14',price:100}}]));
 kv.map.set(KEYS.stage('jp'),JSON.stringify({market:'jp',trade_date:'2026-10-15',kind:'confirmed',complete:true,engine_version:ENGINE_VERSION,close_verification:{ratio:100},stocks:{}}));
 const scope=scopedStorage(env,'background');
 await scope.env.COCKPIT_KV.put(MACRO_STATUS_KEY,JSON.stringify({attempts:Object.fromEntries(Object.keys(MARKET_INDICES.jp).map(k=>[k,{at:new Date().toISOString()}]))}));await scope.finish();
 let calls=0;const rows=syntheticRows(300,'2026-10-15');
 t.mock.method(globalThis,'fetch',async input=>{
  calls++;const u=new URL(String(input));if(!u.pathname.includes('/chart/'))return new Response('',{status:503});
  const symbol=decodeURIComponent(u.pathname.split('/').at(-1)),quote=yahooResult(rows,symbol);
  quote.meta.marketState=null;quote.meta.regularMarketTime=Date.parse('2026-10-15T19:59:58Z')/1000;
  return Response.json({chart:{result:[quote]}});
 });
 assert.equal((await updateCapacity(env,'close')).allowed,true);
 assert.equal((await updateCapacity(env,'auxiliary')).allowed,false);
 for(let i=0;i<2;i++){calls=0;await tick(env);assert.ok(calls<=50);t.mock.timers.tick(300000);}
 const stage=JSON.parse(await kv.get(KEYS.stage('us')));
 assert.equal(stage.kind,'confirmed');assert.equal(stage.trade_date,'2026-10-15');assert.equal(stage.close_verification.ratio,100);
 calls=0;await tick(env);assert.ok(calls<=50);
 const tracked=JSON.parse(await kv.get(TRACKED_KEY));assert.equal(tracked['us:MSTR'].status,'CURRENT');
 assert.equal(tracked['us:MSTR'].row.data_quality.close_confirmed,true);
 // A completed cached row outside the active pool must not be re-fetched hourly.
 t.mock.timers.tick(3600000);calls=0;const writes=kv.writes;
 const repeat=scopedStorage(env,'background');assert.equal((await refreshTrackedAnalysis(repeat.env)).skipped,true);await repeat.finish();
 assert.equal(kv.writes,writes);assert.equal(calls,0);
 const budget=await budgetStatus(env);assert.ok(budget.used.background<350);assert.equal(budget.used.analysis,undefined);
 t.diagnostic(JSON.stringify({used:budget.used,close:stage.close_verification.ratio,tracked:tracked['us:MSTR'].status}));
});

test('dynamic reserve shrinks with remaining half-hour slots, hard limit remains enforced',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-15T22:05:00Z')});
 assert.equal(remainingMacroWrites(),6);assert.equal(remainingMacroWrites(new Date('2026-10-15T00:00:00Z')),50);
 const env=budgetTestEnv();await fill(env,350);
 assert.equal((await updateCapacity(env,'close')).allowed,false);assert.equal((await updateCapacity(env,'macro')).allowed,false);
 const s=scopedStorage(env,'background');await assert.rejects(s.env.COCKPIT_KV.put('overflow','x'),/保存予算/);await s.finish();
 assert.equal((await budgetStatus(env)).used.background,350);
});

test('last trade before closing bell is confirmed only after completed-session grace',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-15T19:59:59Z')});
 const meta={regular_market_time:Date.parse('2026-10-15T19:59:58Z')/1000};
 assert.equal(confirmedByProvider('us',meta,'2026-10-15','confirmed'),false);
 t.mock.timers.tick(61*60000);
 assert.equal(confirmedByProvider('us',meta,'2026-10-15','confirmed'),true);
 assert.equal(confirmedByProvider('us',{regular_market_time:Date.parse('2026-10-14T19:59:58Z')/1000},'2026-10-15','confirmed'),false);
 assert.equal(confirmedByProvider('us',meta,'2026-10-15','intraday'),false);
});

test('futures local date and daily maintenance do not masquerade as stale market data',()=>{
 const quote={price:100,date:'2026-10-15',price_time:'2026-10-16T00:05:00Z'};
 assert.equal(macroFreshness('金',quote,new Date('2026-10-16T00:10:00Z')).data_status,'CURRENT');
 const closed={price:100,date:'2026-10-15',price_time:'2026-10-15T20:59:59Z'};
 assert.equal(macroFreshness('金',closed,new Date('2026-10-15T22:03:00Z')).data_status,'CURRENT');
 assert.equal(macroFreshness('金',closed,new Date('2026-10-15T22:40:00Z')).data_status,'STALE');
});

test('intraday data from the same date is stale after close; a confirmed cache wins',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-15T22:05:00Z')});
 const {assessedRow,latestAnalysis}=await import('../src/services/tracked-data.js');
 const intraday={date:'2026-10-15',price:100,engine_version:ENGINE_VERSION,momentumState:'continuation',price_time:'2026-10-15T19:59:58Z',data_quality:{close_confirmed:false}};
 const close={...intraday,price_time:'2026-10-15T19:59:57Z',data_quality:{close_confirmed:true}};
 assert.equal(assessedRow(intraday,'us').assessment_usable,false);
 assert.equal(latestAnalysis(intraday,close),close);
 assert.equal(assessedRow(close,'us').assessment_usable,true);
});

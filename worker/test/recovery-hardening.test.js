import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRanking} from '../src/services/ranking.js';
import {getMarginDataset} from '../src/services/margin-supply.js';
import {budgetTestEnv} from './budget-fixture.js';
import {scopedStorage,budgetStatus} from '../src/storage/write-budget.js';

test('ranking HTTP 403 shares exponential cooldown across scheduler nodes and automatically retries',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T00:00:00Z')});
 const original=globalThis.fetch,env=budgetTestEnv(),scope=scopedStorage(env,'background');let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:403});};
 try{
  await assert.rejects(refreshRanking(scope.env,'jp'),/403/);
  for(let i=0;i<20;i++)await assert.rejects(refreshRanking(scope.env,'jp'),/403/);
  assert.equal(calls,1);
  t.mock.timers.tick(1800000);await assert.rejects(refreshRanking(scope.env,'jp'),/403/);assert.equal(calls,2);
  t.mock.timers.tick(1800000);await assert.rejects(refreshRanking(scope.env,'jp'),/403/);assert.equal(calls,2);
  t.mock.timers.tick(1800000);await assert.rejects(refreshRanking(scope.env,'jp'),/403/);assert.equal(calls,3);
  await scope.finish();assert.equal(env.COCKPIT_KV.writes,0);assert.equal((await budgetStatus(env)).used.background,undefined);
 }finally{globalThis.fetch=original;}
});
test('margin chooses freshest valid source instead of accepting first stale mirror',async()=>{
 const original=globalThis.fetch,env=budgetTestEnv(),scope=scopedStorage(env,'background');
 globalThis.fetch=async url=>Response.json({schema:'jp-margin-v2',generated_at:'2026-10-01T08:00:00Z',daily:{as_of:String(url).includes('raw.githubusercontent')?'2026-09-29':'2026-09-30'},items:{}});
 try{
  const result=await getMarginDataset(scope.env,{force:true,requireGeneratedDate:'2026-10-01'});
  assert.equal(result.daily.as_of,'2026-09-30');await scope.finish();assert.equal(env.COCKPIT_KV.writes,1);
 }finally{globalThis.fetch=original;}
});

test('JP pre-open refresh expects previous session across weekdays, weekends and holidays',async()=>{
 const {expectedTradingDate}=await import('../src/data/calendar.js');
 assert.equal(expectedTradingDate('jp',new Date('2026-10-01T21:57:00Z')),'2026-10-01');
 assert.equal(expectedTradingDate('jp',new Date('2026-10-01T23:59:59Z')),'2026-10-01');
 assert.equal(expectedTradingDate('jp',new Date('2026-10-02T00:00:00Z')),'2026-10-02');
 assert.equal(expectedTradingDate('jp',new Date('2026-10-04T23:00:00Z')),'2026-10-02');
 assert.equal(expectedTradingDate('jp',new Date('2026-10-12T23:00:00Z')),'2026-10-09');
});

test('JP manual refresh at 06:57 JST commits prior-day close instead of rejecting all stocks',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T21:57:00Z')});
 const {MockKV,syntheticRows,yahooResult}=await import('./helpers.js');
 const {runStageBatch}=await import('../src/services/stage.js');
 const original=globalThis.fetch,rows=syntheticRows(300,'2026-10-01');
 globalThis.fetch=async request=>{
  const symbol=decodeURIComponent(new URL(String(request)).pathname.split('/').at(-1));
  return Response.json({chart:{result:[yahooResult(rows,symbol)]}});
 };
 try{
  const kv=new MockKV({'stocklist:jp':JSON.stringify([{symbol:'6501.T',name:'日立'}])});
  const result=await runStageBatch({COCKPIT_KV:kv},'jp1');
  assert.equal(result.trade_date,'2026-10-01');assert.equal(result.kind,'confirmed');assert.equal(result.committed,true);
 }finally{globalThis.fetch=original;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MockKV } from './helpers.js';
import { refreshRanking, parseRanking } from '../src/services/ranking.js';
import { expectedConfirmedTradingDate } from '../src/data/calendar.js';
import { recordSchedulerFailure, recordSchedulerSuccess, getSystemAudit } from '../src/services/system-health.js';
import { handleStockListAction, getStockList } from '../src/storage/stocklist.js';
import { getStage } from '../src/services/stage.js';
import { buildThemeSnapshotFromStages } from '../src/services/theme-history.js';
import { themeOf } from '../src/config.js';

const page=(start,count,exclude=false)=>Array.from({length:count},(_,i)=>`<a href="/quote/${start+i}.T">${exclude&&i===0?'ETF':'会社'+i}</a> 100,000,000`).join('');
test('fund exclusion does not stop pagination at 49 rows',async t=>{
  const env={COCKPIT_KV:new MockKV()},calls=[];
  t.mock.method(globalThis,'fetch',async url=>{const p=Number(new URL(url).searchParams.get('page'));calls.push(p);return new Response(page(3000+(p-1)*50,50,true));});
  const result=await refreshRanking(env,'jp');
  assert.equal(result.count,300);assert.equal(calls.length,7);assert.equal(new Set(result.items.map(x=>x.symbol)).size,300);
});
test('empty HTML, duplicate pages and HTTP errors preserve last good data and history',async t=>{
  const old={count:100,items:[{symbol:'3001.T'}],trade_date:'2026-09-04',updated_at:'2026-09-04T10:00:00Z'};
  for(const response of [()=>new Response('<h1>Maintenance</h1>'),()=>new Response(page(3000,50)),()=>new Response('Unavailable',{status:403})]){
    const kv=new MockKV({'ranking:jp':JSON.stringify(old),'ranking:history:jp':'{"snapshots":[]}'});
    const mock=t.mock.method(globalThis,'fetch',async()=>response());
    await assert.rejects(refreshRanking({COCKPIT_KV:kv},'jp'));
    assert.deepEqual(JSON.parse(await kv.get('ranking:jp')),old);
    assert.equal(await kv.get('ranking:history:jp'),'{"snapshots":[]}');
    assert.ok(JSON.parse(await kv.get('ranking:status:jp')).last_error);mock.mock.restore();
  }
});
test('an unexpected collapse in ranking count is rejected',async t=>{
  const kv=new MockKV({'ranking:jp':JSON.stringify({count:300,items:[],updated_at:'old'})});
  t.mock.method(globalThis,'fetch',async()=>new Response(page(3000,10)));
  await assert.rejects(refreshRanking({COCKPIT_KV:kv},'jp'),/dropped unexpectedly/);
  assert.equal(JSON.parse(await kv.get('ranking:jp')).count,300);
});
test('ordinary listed companies are not excluded by their numeric code',()=>{assert.equal(parseRanking(page(2502,1),'jp').items.length,1);});
 test('ranking parser distinguishes raw rows and excluded funds',()=>{
  const result=parseRanking(page(3000,50,true),'jp');assert.equal(result.raw_count,50);assert.equal(result.items.length,49);
});
test('freshness accounts for pre-close, processing delay, weekend and US holiday',()=>{
  assert.equal(expectedConfirmedTradingDate('jp',new Date('2026-09-07T06:00:00Z')),'2026-09-04');
  assert.equal(expectedConfirmedTradingDate('jp',new Date('2026-09-07T07:29:00Z')),'2026-09-04');
  assert.equal(expectedConfirmedTradingDate('jp',new Date('2026-09-07T07:30:00Z')),'2026-09-07');
  assert.equal(expectedConfirmedTradingDate('us',new Date('2026-09-07T22:00:00Z')),'2026-09-04');
  assert.equal(expectedConfirmedTradingDate('us',new Date('2026-09-08T20:59:00Z')),'2026-09-04');
  assert.equal(expectedConfirmedTradingDate('us',new Date('2026-09-08T21:00:00Z')),'2026-09-08');
});
test('unrelated success does not hide failures; related later recovery resolves them',async()=>{
  const env={COCKPIT_KV:new MockKV()},failed={key:'jp_close:b1',market:'jp',action:'stage',kind:'confirmed',part:1,tradeDate:'2026-09-04'};
  await recordSchedulerFailure(env,failed,new Error('quote unavailable'));
  const unrelated=await recordSchedulerSuccess(env,{key:'macro',market:'macro',action:'macro'});
  assert.equal(unrelated.last_error,'quote unavailable');
  const recovered=await recordSchedulerSuccess(env,{...failed,key:'jp_recovery:b1',tradeDate:'2026-09-07'});
  assert.equal(recovered.last_error,null);assert.deepEqual(recovered.node_errors,{});
});
test('shared themes, manual overrides and unclassified groups agree',async()=>{
  assert.equal(themeOf('MU'),'メモリ・ストレージ');assert.equal(themeOf('NFLX'),'消費・娯楽');assert.equal(themeOf('ZZZZZZ'),'未分類');
  const kv=new MockKV({'stocklist:us':JSON.stringify([{symbol:'MU',name:'Micron'}]),'stage:us':JSON.stringify({market:'us',complete:true,trade_date:'2020-01-01',stocks:{MU:{symbol:'MU',theme:'半導体'}},macro:{}})}),env={COCKPIT_KV:kv};
  assert.equal((await handleStockListAction(env,'us',{action:'theme',symbol:'MU',theme:'独自テーマ'})).ok,true);
  assert.equal((await getStockList(env,'us'))[0].theme_override,'独自テーマ');
  const stage=await getStage(env,'us');assert.equal(stage.stocks.MU.theme,'独自テーマ');assert.equal(stage.is_stale,true);
  await handleStockListAction(env,'us',{action:'theme',symbol:'MU',theme:''});assert.equal((await getStage(env,'us')).stocks.MU.theme,'メモリ・ストレージ');
  const snapshot=buildThemeSnapshotFromStages({stocks:{ZZZZZZ:{symbol:'ZZZZZZ',theme:'その他',entry_lane:'A'}}},{});
  assert.deepEqual(snapshot.themes,{});
});
test('health exposes dataset age without returning investment records',async()=>{
  const env={COCKPIT_KV:new MockKV({'ranking:jp':JSON.stringify({trade_date:'2020-01-01',updated_at:'2020-01-01',items:[{symbol:'PRIVATE'}]})})};
  const audit=await getSystemAudit(env);assert.equal(audit.datasets.ranking_jp.stale,true);assert.equal(audit.datasets.ranking_us.available,false);assert.ok(!JSON.stringify(audit).includes('PRIVATE'));
});
test('frontend marks outdated confirmed snapshots as delayed',()=>{
  const html=readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
  const fn=html.match(/function freshnessKind\(st\)\{[^\n]+/)[0];
  const context=vm.createContext({});vm.runInContext(fn,context);
  assert.equal(context.freshnessKind({complete:true,kind:'confirmed',is_stale:true,close_verification:{ratio:100}}),'warn');
  assert.equal(context.freshnessKind({complete:true,kind:'confirmed',is_stale:false,close_verification:{ratio:100}}),'good');
});

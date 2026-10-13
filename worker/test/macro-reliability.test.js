import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { refreshMacroSnapshots, getStage } from '../src/services/stage.js';
import { macroFreshness, MACRO_STATUS_KEY } from '../src/services/macro-freshness.js';
import { evaluateRiskGate, mergeMacroSnapshots } from '../src/services/integrity.js';
import { KEYS } from '../src/storage/kv-schema.js';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';
import { budgetTestEnv } from './budget-fixture.js';
const now=new Date('2026-10-13T21:45:00Z');
const fresh=(name,date='2026-10-13')=>({price:100,date,price_time:date+(name==='日経平均'||name==='韓国KOSPI'?'T06:30:00Z':'T20:00:00Z'),change_pct:1,ret5:2});

test('stale shock cannot claim current stress or normal; missing timestamp cannot pass',()=>{
  const macro=Object.fromEntries(['日経平均','S&P500','韓国KOSPI','SOX','VIX'].map(n=>[n,fresh(n)]));
  assert.equal(evaluateRiskGate('jp',macro,now).level,'normal');
  macro.SOX={...fresh('SOX','2026-10-12'),ret5:-10};
  assert.equal(evaluateRiskGate('jp',macro,now).level,'unknown');
  assert.equal(evaluateRiskGate('jp',macro,now).block_new_entries,true);
  assert.equal(macroFreshness('日経平均',{price:100,date:'2026-10-13'},now).assessment_usable,false);
});

test('JP holiday and US close are evaluated by their own sessions',()=>{
  assert.equal(macroFreshness('日経平均',fresh('日経平均','2026-10-09'),new Date('2026-10-12T12:00:00Z')).data_status,'CURRENT');
  assert.equal(macroFreshness('SOX',fresh('SOX','2026-10-12'),now).data_status,'STALE');
  const noon={...fresh('日経平均'),price_time:'2026-10-13T02:00:00Z'};
  assert.equal(macroFreshness('日経平均',noon,now).data_status,'STALE');
  assert.equal(macroFreshness('日経平均',fresh('日経平均','2026-10-16'),new Date('2026-10-18T01:00:00Z')).data_status,'CURRENT');
});

test('later fetch must not replace a later price observation with an older quote',()=>{
  const a={SOX:{...fresh('SOX'),price_time:'2026-10-13T20:00:00Z',fetched_at:'2026-10-13T20:01:00Z'}};
  const b={SOX:{...fresh('SOX'),price:90,price_time:'2026-10-13T18:00:00Z',fetched_at:'2026-10-13T22:00:00Z'}};
  assert.equal(mergeMacroSnapshots(a,b).SOX.price,100);
});

test('all-provider outage is not successful and does not rewrite canonical prices',async t=>{
  const kv=new MockKV({[KEYS.macroCurrent]:JSON.stringify({items:{SOX:fresh('SOX','2026-10-12')}})});
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  const result=await refreshMacroSnapshots({COCKPIT_KV:kv},{now});
  assert.equal(result.ok,false);assert.equal(result.received,0);assert.equal(result.retry_required,true);
  assert.equal(kv.writes,1); // Coordination status only, no price write.
  assert.equal(JSON.parse(await kv.get(KEYS.macroCurrent)).items.SOX.date,'2026-10-12');
  assert.match(result.attempts.SOX.error,/503/);
});

test('stale first endpoint falls back, partial success persists, unchanged retry spends no price write',async t=>{
  const kv=new MockKV();let calls=0;
  t.mock.method(globalThis,'fetch',async input=>{
    calls++;const u=new URL(String(input)),symbol=decodeURIComponent(u.pathname.split('/').at(-1));
    if(symbol==='^TOPX')return new Response('',{status:404});
    const date=u.hostname.startsWith('query1')?'2026-10-12':'2026-10-13';
    const result=yahooResult(syntheticRows(70,date),symbol);
    result.meta.regularMarketTime=Date.parse(date+(['^N225','^NKVI.OS','^KS11','^KQ11'].includes(symbol)?'T06:30:00Z':'T21:30:00Z'))/1000;
    return Response.json({chart:{result:[result]}});
  });
  const result=await refreshMacroSnapshots({COCKPIT_KV:kv},{now});
  assert.equal(result.ok,false);assert.ok(result.received>=15);assert.ok(calls<=36);
  assert.equal(result.items.SOX.date,'2026-10-13');assert.ok(result.failed.includes('TOPIX'));
  const before=kv.writes;calls=0;
  const again=await refreshMacroSnapshots({COCKPIT_KV:kv},{now:new Date(+now+31*60000)});
  assert.equal(again.changed,false);assert.equal(kv.writes-before,1);assert.ok(calls<=36);
});

test('macro runs before backtest/stocks even above auxiliary budget cutoff',async t=>{
  t.mock.timers.enable({apis:['Date'],now:+now});
  const env=budgetTestEnv();env.COCKPIT_KV.map.set(KEYS.schema,'vantage-kv-v3');
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  let work;await worker.scheduled({cron:'*/5 * * * *',scheduledTime:+now},env,{waitUntil:p=>work=p});await work;
  // DO coordination is not a KV publication and is exposed through scoped storage.
  const {scopedStorage}=await import('../src/storage/write-budget.js');
  const scope=scopedStorage(env,'read');const state=JSON.parse(await scope.env.COCKPIT_KV.get(MACRO_STATUS_KEY));
  assert.equal(state.received,0);assert.equal(state.ok,false);await scope.finish();
});

test('fresh quote replaces a missing daily candle using its own timestamp',async()=>{
  const {yahooMacroQuote}=await import('../src/data/macro-quotes.js');
  const rows=syntheticRows(70,'2026-10-09'),raw=yahooResult(rows,'^N225');
  raw.meta={...raw.meta,exchangeTimezoneName:'Asia/Tokyo',regularMarketPrice:67777.52,regularMarketChangePercent:-1.816,regularMarketTime:Date.parse('2026-10-13T06:45:03Z')/1000};
  const quote=yahooMacroQuote(raw,'^N225',now);
  assert.equal(quote.price,67777.52);assert.equal(quote.date,'2026-10-13');assert.equal(quote.change_pct,-1.816);
  assert.equal(macroFreshness('日経平均',quote,now).data_status,'CURRENT');
  raw.meta.regularMarketTime=Date.parse('2026-10-09T06:45:03Z')/1000;
  assert.equal(yahooMacroQuote(raw,'^N225',now).date,'2026-10-09');
});

test('TOPIX structured source verifies index identity and observation date',async()=>{
  const {parseTopixPage}=await import('../src/data/macro-quotes.js');
  const state={mainDomesticIndexPriceBoard:{indexPrices:{code:'998405.T',name:'TOPIX',price:'4,110.67',changePriceRate:'0.14',japanUpdateTime:'15:30'}},
    mainDomesticIndexDetail:{indexPrices:{openPriceDatetime:'10/13'}},
    mainItemDetailChartSetting:{timeSeriesData:{latestHistoryBaseDatetime:'2026-10-13T00:00:00+09:00',histories:[{baseDatetime:'2026-10-09T00:00:00+09:00',closePrice:4104.81},{baseDatetime:'2026-10-13T00:00:00+09:00',closePrice:4110.67}]}}};
  const html=()=>'<script>window.__PRELOADED_STATE__ = '+JSON.stringify(state)+'\n</script>';
  const quote=parseTopixPage(html(),now);assert.equal(quote.price,4110.67);assert.equal(quote.date,'2026-10-13');
  assert.equal(quote.price_time,'2026-10-13T06:30:00.000Z');assert.equal(quote.ret5,null);
  state.mainDomesticIndexPriceBoard.indexPrices.code='1306.T';assert.throws(()=>parseTopixPage(html(),now),/identity/);
  state.mainDomesticIndexPriceBoard.indexPrices.code='998405.T';state.mainDomesticIndexDetail.indexPrices.openPriceDatetime='10/14';assert.throws(()=>parseTopixPage(html(),now),/date mismatch/);
});

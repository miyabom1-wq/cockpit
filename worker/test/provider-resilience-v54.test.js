import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSyncBatch, parseChartMetaEvent } from '../src/services/events.js';
import { benchmarkSymbols, shouldAutoRestartBacktest } from '../src/services/backtest.js';

test('event sync defaults to ten symbols per request',()=>{
  const items=Array.from({length:25},(_,i)=>({symbol:`S${i}`}));
  const batch=eventSyncBatch(items,1);
  assert.equal(batch.batch_size,10);
  assert.equal(batch.batch_count,3);
  assert.equal(batch.items.length,10);
  assert.equal(batch.items[0].symbol,'S10');
});

test('chart metadata supplies an earnings fallback',()=>{
  const event=parseChartMetaEvent(
    {earningsTimestamp:1784901600,earningsTimestampStart:1784901600,earningsTimestampEnd:1784988000},
    {symbol:'TEST',name:'Test Corp',market:'us',scope:'registered'}
  );
  assert.equal(event.symbols[0],'TEST');
  assert.equal(event.source_name,'Yahoo Finance chart metadata');
  assert.equal(event.tracked_scope,'registered');
});

test('benchmark candidates always include a fallback index',()=>{
  assert.deepEqual(benchmarkSymbols('jp','primary'),['^N225','^TOPX']);
  assert.deepEqual(benchmarkSymbols('jp','secondary'),['^TOPX','^N225']);
  assert.deepEqual(benchmarkSymbols('us','primary'),['^GSPC','^IXIC']);
  assert.deepEqual(benchmarkSymbols('us','secondary'),['^IXIC','^GSPC']);
});

test('fully transient failed cycle is eligible for automatic restart',()=>{
  assert.equal(shouldAutoRestartBacktest({
    status:'failed',
    failures:[
      {category:'provider_access'},
      {category:'network'},
      {category:'rate_limit'}
    ]
  }),true);
  assert.equal(shouldAutoRestartBacktest({
    status:'failed',
    failures:[{category:'history_short'}]
  }),false);
});

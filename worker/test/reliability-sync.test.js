import test from 'node:test';
import assert from 'node:assert/strict';
import { trackedEventUniverse, eventSyncBatch } from '../src/services/events.js';
import { reconcileProposalForCurrent } from '../src/services/universe-manager.js';
import { shouldIncrementSignalSeen } from '../src/services/signal-log.js';

test('event sync includes registered stocks after watch and signals',()=>{
  const rows=trackedEventUniverse({
    watch:[{symbol:'285A.T',name:'キオクシア',market:'jp'}],
    signals:[{symbol:'MU',name:'Micron',market:'us',active:true}],
    registered:{
      jp:[{symbol:'6857.T',name:'アドバンテスト'}],
      us:[{symbol:'VRT',name:'Vertiv'}]
    }
  });
  assert.deepEqual(rows.map(x=>x.symbol),['285A.T','MU','6857.T','VRT']);
  assert.equal(rows.find(x=>x.symbol==='6857.T').scope,'registered');
});

test('event sync batches stay below the external request limit',()=>{
  const items=Array.from({length:81},(_,i)=>({symbol:`S${i}`}));
  const p=eventSyncBatch(items,1,20);
  assert.equal(p.batch_count,5);
  assert.equal(p.items.length,20);
  assert.equal(p.items[0].symbol,'S20');
});

test('stale universe proposal keeps only valid replacement pairs',()=>{
  const current=[{symbol:'MU'},{symbol:'VRT'}];
  const p=reconcileProposalForCurrent(current,{
    adds:[
      {symbol:'MU',replacement:'VRT'},
      {symbol:'NVDA',replacement:'VRT'},
      {symbol:'ANET',replacement:'OLD'}
    ],
    drops:[{symbol:'OLD'},{symbol:'VRT'}]
  },'us');
  assert.deepEqual(p.adds.map(x=>x.symbol),['NVDA','ANET']);
  assert.equal(p.adds.find(x=>x.symbol==='NVDA').replacement,'VRT');
  assert.equal(p.adds.find(x=>x.symbol==='ANET').replacement,null);
  assert.deepEqual(p.drops.map(x=>x.symbol),['VRT']);
  assert.equal(p.stale_removed,2);
});

test('signal continuation is counted only once per trading date',()=>{
  assert.equal(shouldIncrementSignalSeen({last_seen_date:'2026-07-23'},'2026-07-23'),false);
  assert.equal(shouldIncrementSignalSeen({last_seen_date:'2026-07-22'},'2026-07-23'),true);
});

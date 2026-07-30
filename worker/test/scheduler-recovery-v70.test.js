import test from 'node:test';
import assert from 'node:assert/strict';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';
import { scheduledStage } from '../src/index.js';

function stockList(count){
  return Array.from({length:count},(_,i)=>({
    symbol:`${String(2000+i).padStart(4,'0')}.T`,
    name:`対象${i+1}`,
  }));
}

test('a stale first batch is cooled down so the next batch can proceed',async()=>{
  const staleRows=syntheticRows(300,'2026-07-29');
  const goodRows=syntheticRows(300,'2026-07-30');
  const list=stockList(21);
  const firstBatch=new Set(list.slice(0,20).map(x=>x.symbol));
  const old=globalThis.fetch;

  globalThis.fetch=async request=>{
    const url=new URL(String(request));
    const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
    const rows=firstBatch.has(symbol)?staleRows:goodRows;
    return new Response(JSON.stringify({
      chart:{result:[yahooResult(rows,symbol)],error:null}
    }),{status:200,headers:{'content-type':'application/json'}});
  };

  try{
    const kv=new MockKV({'stocklist:jp':JSON.stringify(list)});
    const env={COCKPIT_KV:kv};

    const first=await scheduledStage(env,new Date('2026-07-30T09:35:00.000Z'));
    assert.equal(first.node,'jp_1800_recovery:b1');
    assert.equal(first.retry,true);

    const second=await scheduledStage(env,new Date('2026-07-30T09:40:00.000Z'));
    assert.equal(second.node,'jp_1800_recovery:b2');
    assert.equal(second.retry,true);

    const workingKeys=[...kv.map.keys()].filter(k=>k.includes('stage:working:')&&k.endsWith(':part:2'));
    assert.equal(workingKeys.length,1);
  }finally{
    globalThis.fetch=old;
  }
});

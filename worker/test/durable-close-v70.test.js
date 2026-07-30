import test from 'node:test';
import assert from 'node:assert/strict';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';
import { runStageBatch, getStage, registeredMarketParts } from '../src/services/stage.js';

function stockList(count){
  return Array.from({length:count},(_,i)=>({
    symbol:`${String(1000+i).padStart(4,'0')}.T`,
    name:`銘柄${i+1}`,
  }));
}

test('registered part count follows the actual stock list',async()=>{
  const kv=new MockKV({'stocklist:jp':JSON.stringify(stockList(21))});
  assert.equal(await registeredMarketParts({COCKPIT_KV:kv},'jp'),2);
});

test('a stale batch no longer blocks later batches when global freshness is sufficient',async()=>{
  const goodRows=syntheticRows(300,'2026-07-16');
  const staleRows=syntheticRows(300,'2026-07-15');
  const list=stockList(40);
  const stale=new Set(list.slice(0,3).map(x=>x.symbol));
  const old=globalThis.fetch;

  globalThis.fetch=async request=>{
    const url=new URL(String(request));
    const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
    const rows=stale.has(symbol)?staleRows:goodRows;
    return new Response(JSON.stringify({
      chart:{result:[yahooResult(rows,symbol)],error:null}
    }),{status:200,headers:{'content-type':'application/json'}});
  };

  try{
    const kv=new MockKV({'stocklist:jp':JSON.stringify(list)});
    const env={COCKPIT_KV:kv};
    const options={
      snapshotId:'JP-20260716-CONFIRMED-DURABLE',
      kind:'confirmed',
      tradeDate:'2026-07-16',
      parts:2,
      minConfirmedRatio:90,
    };

    const first=await runStageBatch(env,'jp1',options);
    assert.equal(first.committed,false);
    assert.equal(first.retry_required,true);
    assert.equal(first.batch_freshness.confirmed_ratio,85);

    const second=await runStageBatch(env,'jp2',options);
    assert.equal(second.committed,true);
    assert.equal(second.retry_required,false);
    assert.equal(second.global_freshness.confirmed_ratio,92.5);

    const stage=await getStage(env,'jp');
    assert.equal(stage.trade_date,'2026-07-16');
    assert.equal(stage.close_verification.ratio,92.5);
    assert.equal(Object.keys(stage.stocks).length,40);
  }finally{
    globalThis.fetch=old;
  }
});

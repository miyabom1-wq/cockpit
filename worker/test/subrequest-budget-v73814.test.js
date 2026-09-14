import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledStage} from '../src/index.js';
import {stageFreshness} from '../src/services/stage-freshness.js';
import {MockKV,syntheticRows,yahooResult} from './helpers.js';
import {KEYS} from '../src/storage/kv-schema.js';


test('160 JP stocks finish across cron invocations under a hard 50-fetch budget, even with provider fallback',async()=>{
  const old=globalThis.fetch,rows=syntheticRows(300,'2026-07-30');
  const list=Array.from({length:160},(_,i)=>({symbol:`${2000+i}.T`,name:`Stock ${i}`}));
  const kv=new MockKV({'stocklist:jp':JSON.stringify(list)});
  let requests=0;
  globalThis.fetch=async request=>{
    if(++requests>50)throw Error('Too many subrequests by single Worker invocation');
    const url=new URL(String(request));
    if(url.hostname==='query1.finance.yahoo.com')return new Response('',{status:503});
    const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
    return Response.json({chart:{result:[yahooResult(rows,symbol)]}});
  };
  try{
    for(let i=0;i<8;i++){
      requests=0;
      const result=await scheduledStage({COCKPIT_KV:kv},new Date(Date.parse('2026-07-30T09:00:00Z')+i*300000));
      assert.equal(result.retry,undefined);
      assert.equal(result.processed,1);
      assert.ok(requests<=44,`fetch count ${requests}`);
    }
    const stage=JSON.parse(await kv.get(KEYS.stage('jp')));
    assert.equal(stage.kind,'confirmed');
    assert.equal(stage.close_verification.ratio,100);
    assert.equal(Object.keys(stage.stocks).length,160);
  }finally{globalThis.fetch=old;}
});

test('same-day lunch snapshot is stale after close deadline, including weekends',()=>{
  const stage={market:'jp',complete:true,trade_date:'2026-09-14',kind:'intraday'};
  assert.equal(stageFreshness(stage,new Date('2026-09-14T14:00:00Z')).is_stale,true);
  assert.equal(stageFreshness(stage,new Date('2026-09-14T04:00:00Z')).is_stale,false);
  assert.equal(stageFreshness({...stage,kind:'confirmed',close_verification:{ratio:100}},new Date('2026-09-14T14:00:00Z')).is_stale,false);
  assert.equal(stageFreshness({...stage,trade_date:'2026-09-11'},new Date('2026-09-12T14:00:00Z')).is_stale,true);
});

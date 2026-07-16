import test from 'node:test';
import assert from 'node:assert/strict';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';
import { analyzeSymbolsNow } from '../src/services/stage.js';

test('bulk ranking analysis shares one benchmark pair and stays below Worker subrequest limit', async()=>{
  const rows=syntheticRows(300,'2026-07-16');
  const body=JSON.stringify({chart:{result:[yahooResult(rows)],error:null}});
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(body,{status:200,headers:{'content-type':'application/json'}});};
  try{
    const env={COCKPIT_KV:new MockKV()};
    const items=Array.from({length:35},(_,i)=>({symbol:String(1000+i)+'.T',name:'銘柄'+i}));
    const r=await analyzeSymbolsNow(env,items,'jp',{label:'TEST',cacheTtl:0});
    assert.equal(r.items.length,35);
    assert.equal(calls,37); // 35銘柄 + 日経平均 + TOPIX
    assert.ok(calls<50);
  }finally{globalThis.fetch=old;}
});

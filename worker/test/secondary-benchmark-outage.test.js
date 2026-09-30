import test from 'node:test';
import assert from 'node:assert/strict';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';
import { runStageBatch } from '../src/services/stage.js';

test('TOPIX outage keeps primary RS and publishes current JP stocks with null secondary RS',async()=>{
 const old=globalThis.fetch, rows=syntheticRows(300,'2026-09-24');
 globalThis.fetch=async request=>{
  const symbol=decodeURIComponent(new URL(String(request)).pathname.split('/').at(-1));
  if(symbol==='^TOPX')return new Response('',{status:404});
  return new Response(JSON.stringify({chart:{result:[yahooResult(rows,symbol)]}}));
 };
 try{
  const kv=new MockKV({'stocklist:jp':JSON.stringify([{symbol:'6501.T',name:'日立'}])});
  const result=await runStageBatch({COCKPIT_KV:kv},'jp1',{snapshotId:'outage-test',kind:'confirmed',tradeDate:'2026-09-24',parts:1});
  assert.equal(result.committed,true);
  const payload=JSON.parse(kv.map.get('stage:working:outage-test:part:1'));
  assert.equal(payload.stocks[0].date,'2026-09-24');
  assert.equal(typeof payload.stocks[0].rs5,'number');
  assert.equal(payload.stocks[0].secondary_rs5,null);
  const benchmark=JSON.parse(kv.map.get('stage:working:outage-test:benchmark'));
  assert.match(benchmark.secondary_error,/TOPX HTTP 404/);
 }finally{globalThis.fetch=old;}
});

test('primary index failure still blocks publication',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:404});
 try{
  const kv=new MockKV({'stocklist:jp':JSON.stringify([{symbol:'6501.T',name:'日立'}])});
  await assert.rejects(runStageBatch({COCKPIT_KV:kv},'jp1',{snapshotId:'primary-outage',kind:'confirmed',tradeDate:'2026-09-24',parts:1}),/N225 HTTP 404/);
  assert.equal(kv.map.has('stage:working:primary-outage:part:1'),false);
 }finally{globalThis.fetch=old;}
});

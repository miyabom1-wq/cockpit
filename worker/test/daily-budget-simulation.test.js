import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {budgetTestEnv} from './budget-fixture.js';
import {budgetStatus} from '../src/storage/write-budget.js';
import {syntheticRows,yahooResult} from './helpers.js';
import {expectedTradingDate} from '../src/data/calendar.js';
import {KEYS} from '../src/storage/kv-schema.js';
import {BACKTEST_VERSION} from '../src/config.js';

for(const outage of [false,true])test(`288 cron invocations with 160 JP/40 US symbols; outage=${outage}`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-24T00:00:00Z')});
 const env=budgetTestEnv(),kv=env.COCKPIT_KV;
 kv.map.set(KEYS.schema,'vantage-kv-v3');
 kv.map.set('stocklist:jp',JSON.stringify(Array.from({length:160},(_,i)=>({symbol:`${2000+i}.T`,name:'JP'}))));
 kv.map.set('stocklist:us',JSON.stringify(Array.from({length:40},(_,i)=>({symbol:`US${i}`,name:'US'}))));
 kv.map.set(`backtest:${BACKTEST_VERSION}:state`,JSON.stringify({updated_at:'2026-09-24T00:00:00Z',status:'complete'}));
 const oldFetch=globalThis.fetch,oldError=console.error;console.error=()=>{};
 const rowsCache=new Map();let completedJp=false,completedUs=false;
 globalThis.fetch=async input=>{
  const u=new URL(String(input));
  if(outage||!u.pathname.includes('/chart/'))return new Response('',{status:503});
  const symbol=decodeURIComponent(u.pathname.split('/').at(-1)),market=symbol.endsWith('.T')||['^N225','^TOPX'].includes(symbol)?'jp':'us';
  const date=expectedTradingDate(market,new Date());
  if(!rowsCache.has(date))rowsCache.set(date,syntheticRows(300,date));
  return Response.json({chart:{result:[yahooResult(rowsCache.get(date),symbol)]}});
 };
 try{
  for(let i=0;i<288;i++){
   let work;await worker.scheduled({},env,{waitUntil:p=>{work=p;}});await work;
   completedJp ||=JSON.parse(kv.map.get(KEYS.stage('jp'))||'{}').kind==='confirmed';
   completedUs ||=JSON.parse(kv.map.get(KEYS.stage('us'))||'{}').kind==='confirmed';
   if(i<287)t.mock.timers.tick(300000);
  }
  const status=await budgetStatus(env);
  t.diagnostic(JSON.stringify({outage,writes:kv.writes,deletes:kv.deletes,budget:status.used,completedJp,completedUs}));
  assert.ok(kv.writes+kv.deletes<=550);
  assert.equal(status.used.user,undefined);
  if(!outage){assert.equal(completedJp,true);assert.equal(completedUs,true);}
  const r=await worker.fetch(new Request('https://example.com/api/positions',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({action:'toggle_held',symbol:'MSTR',market:'us'})}),env);
  assert.equal(r.status,200);assert.equal((await r.json()).held,true);
 }finally{globalThis.fetch=oldFetch;console.error=oldError;}
});

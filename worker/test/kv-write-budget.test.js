import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MockKV } from './helpers.js';
import { KEYS } from '../src/storage/kv-schema.js';
import { BACKTEST_VERSION } from '../src/config.js';
import { getWatchlist, mutateWatchlist } from '../src/services/watchlist.js';
import { captureSignalLog, getSignalLog } from '../src/services/signal-log.js';
import { recordCronHeartbeat, getSystemAudit } from '../src/services/system-health.js';
import { runBacktestStep } from '../src/services/backtest.js';
import { getStockList, saveStockList } from '../src/storage/stocklist.js';

test('legacy watch reads and unchanged updates need no writes; real add uses one write',async()=>{
 const legacy={id:'old',symbol:'7203.T',market:'jp',status:'legacy',memo:'keep',added_at:'2026-09-01'};
 const kv=new MockKV({[KEYS.watch]:JSON.stringify([legacy])}),env={COCKPIT_KV:kv};
 for(let n=0;n<10;n++)assert.equal((await getWatchlist(env)).items[0].status,'tracking');
 await mutateWatchlist(env,{action:'update',id:'old',status:'tracking',memo:'keep'});
 await mutateWatchlist(env,{action:'add',symbol:'7203',market:'jp'});
 assert.equal(kv.writes,0);
 assert.deepEqual(JSON.parse(await kv.get(KEYS.watch)),[legacy]);
 await mutateWatchlist(env,{action:'add',symbol:'1605',market:'jp'});
 assert.equal(kv.writes,1);
 assert.equal(JSON.parse(await kv.get(KEYS.watch))[0].legacy_status,'legacy');
 kv.put=async()=>{throw Error('KV put() limit exceeded for the day.')};
 assert.equal((await getWatchlist(env)).items.length,2);
 await assert.rejects(mutateWatchlist(env,{action:'add',symbol:'2914',market:'jp'}),/limit exceeded/);
 assert.equal((await getWatchlist(env)).items.length,2);
});

test('identical signal captures do not write, but corrected prices still persist',async()=>{
 const date='2026-09-18',stage={complete:true,kind:'confirmed',trade_date:date,snapshot_id:'same-id',close_verification:{ratio:100},stocks:{'1111.T':{symbol:'1111.T',market:'jp',name:'Test',date,price:100,entry_lane:'A',data_quality:{data_valid:true,close_confirmed:true}}}};
 const kv=new MockKV({[KEYS.stage('jp')]:JSON.stringify(stage)}),env={COCKPIT_KV:kv};
 await captureSignalLog(env,'jp');
 const first=await kv.get(KEYS.signalV5);
 for(let i=0;i<20;i++)await captureSignalLog(env,'jp');
 assert.equal(kv.writes,1);
 assert.equal(await kv.get(KEYS.signalV5),first);
 assert.ok((await getSignalLog(env)).updated_at);
 stage.stocks['1111.T'].price=110;
 kv.map.set(KEYS.stage('jp'),JSON.stringify(stage));
 await captureSignalLog(env,'jp');
 assert.equal(kv.writes,2);
 assert.equal((await getSignalLog(env)).items[0].latest_close,110);
});

test('five-minute cron produces 144 heartbeat writes per day and retains health detection',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-18T00:00:00Z')});
 const kv=new MockKV(),env={COCKPIT_KV:kv};
 for(let i=0;i<288;i++){
  await recordCronHeartbeat(env);
  assert.equal((await getSystemAudit(env)).scheduler.alive,true);
  t.mock.timers.tick(300000);
 }
 assert.equal(kv.writes,144);
 t.mock.timers.tick(1200000);
 assert.equal((await getSystemAudit(env)).scheduler.alive,false);
});

test('scheduled backtest cooldown uses persisted progress and performs zero writes',async()=>{
 const kv=new MockKV({[`backtest:${BACKTEST_VERSION}:state`]:JSON.stringify({updated_at:new Date().toISOString()})});
 for(let i=0;i<10;i++)assert.equal((await runBacktestStep({COCKPIT_KV:kv},1,false,{scheduled:true})).reason,'scheduled write cooldown');
 assert.equal(kv.writes,0);
});

test('registered display sorts JP codes including letters and US tickers without changing tiers or persisted order',async()=>{
 const html=readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
 const fn=html.slice(html.indexOf('function sortedRegisteredStocks('),html.indexOf('function universeCurrentBlock('));
 const sort=vm.runInNewContext(fn+';sortedRegisteredStocks');
 const jp=[{symbol:'7203.T',focus_tier:'core'},{symbol:'285A.T',focus_tier:'radar'},{symbol:'1605.T',focus_tier:'radar'},{symbol:'130A.T',focus_tier:'core'}];
 assert.deepEqual(Array.from(sort(jp,'jp'),x=>x.symbol),['130A.T','1605.T','285A.T','7203.T']);
 assert.deepEqual(Array.from(sort([{symbol:'NVDA'},{symbol:'aapl'},{symbol:'BRK-B'}],'us'),x=>x.symbol),['aapl','BRK-B','NVDA']);
 assert.equal(jp[0].symbol,'7203.T');assert.equal(sort(jp,'jp').at(-1).focus_tier,'core');
 const kv=new MockKV(),env={COCKPIT_KV:kv};
 await saveStockList(env,'jp',jp);
 const list=await getStockList(env,'jp');
 await saveStockList(env,'jp',list);
 assert.equal(kv.writes,1);
 assert.equal((await getStockList(env,'jp'))[0].symbol,'7203.T');
});

test('a day of failed background backtests is bounded to 48 attempts, while manual retry stays immediate',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-18T00:00:00Z')});
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('unavailable',{status:503});
 const kv=new MockKV({'stocklist:jp':'[{"symbol":"7203.T","name":"Toyota"}]','stocklist:us':'[]'}),env={COCKPIT_KV:kv};
 try{
  let attempts=0;
  for(let i=0;i<288;i++){
   const result=await runBacktestStep(env,1,false,{scheduled:true});
   if(result.paused)attempts++;
   t.mock.timers.tick(300000);
  }
  assert.equal(attempts,48);
  assert.equal(kv.writes,97); // Initial state + lock and error-progress per attempt.
  await runBacktestStep(env,1,false,{scheduled:true});
  const before=kv.writes;
  const manual=await runBacktestStep(env,1,false);
  assert.equal(manual.paused,true);
  assert.equal(kv.writes,before+2);
 }finally{globalThis.fetch=oldFetch;}
});

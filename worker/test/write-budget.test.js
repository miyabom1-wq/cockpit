import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetTestEnv as setup} from './budget-fixture.js';
import {WriteBudget, scopedStorage, requestLane, budgetStatus, WRITE_LIMITS} from '../src/storage/write-budget.js';
import {MockKV} from './helpers.js';
import {mutatePosition} from '../src/services/positions.js';
import {KEYS} from '../src/storage/kv-schema.js';


async function use(env,lane,count){const scope=scopedStorage(env,lane);try{for(let i=0;i<count;i++)await scope.env.COCKPIT_KV.put('k',String(i));}finally{await scope.finish();}}

test('concurrent background requests cannot consume analysis or management reserve',async()=>{
 const env=setup();
 await Promise.allSettled(Array.from({length:100},()=>use(env,'background',32)));
 assert.equal(env.COCKPIT_KV.writes,350);
 await use(env,'analysis',20);await use(env,'user',2);
 assert.equal(env.COCKPIT_KV.writes,372);
 assert.deepEqual((await budgetStatus(env)).used,{background:350,analysis:20,user:2});
});
test('all lanes together stop at 500 attempted writes, leaving 500 account margin',async()=>{
 const env=setup();
 for(const lane of Object.keys(WRITE_LIMITS))await Promise.allSettled(Array.from({length:40},()=>use(env,lane,32)));
 assert.equal(env.COCKPIT_KV.writes,500);
});
test('viewing has zero durable writes, deletes or budget requests',async()=>{
 const env=setup(),scope=scopedStorage(env,'read');
 env.WRITE_BUDGET.get=()=>{throw Error('view must not reserve');};
 for(let i=0;i<200;i++){await scope.env.COCKPIT_KV.put('cache','value');assert.equal(await scope.env.COCKPIT_KV.get('cache'),'value');await scope.env.COCKPIT_KV.delete('cache');}
 await scope.finish();assert.equal(env.COCKPIT_KV.writes,0);assert.equal(env.COCKPIT_KV.deletes,0);
});
test('failed KV writes are charged; settlement is idempotent',async()=>{
 const env=setup();env.COCKPIT_KV.put=async()=>{throw Error('provider failure');};
 const scope=scopedStorage(env,'user');await assert.rejects(scope.env.COCKPIT_KV.put('x','y'));
 await scope.finish();await scope.finish();assert.equal((await budgetStatus(env)).used.user,1);
});
test('lost invocation reserves capacity rather than allowing overspend',async()=>{
 const env=setup(),scope=scopedStorage(env,'background');await scope.env.COCKPIT_KV.put('x','y');
 assert.equal((await budgetStatus(env)).used.background,32);
});
test('UTC day reset restores capacity; old settlement cannot subtract from new day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-24T23:59:00Z')});
 const env=setup(),scope=scopedStorage(env,'user');await scope.env.COCKPIT_KV.put('x','y');
 t.mock.timers.tick(60000);await scope.finish();
 assert.equal((await budgetStatus(env)).used.user,undefined);
 await use(env,'user',1);assert.equal((await budgetStatus(env)).used.user,1);
});
test('missing coordinator fails closed for writes while viewing stays available',async()=>{
 const env={COCKPIT_KV:new MockKV()},scope=scopedStorage(env,'user');
 await assert.rejects(scope.env.COCKPIT_KV.put('x','y'),/設定が未反映/);assert.equal(env.COCKPIT_KV.writes,0);
});
test('budget exhaustion preserves holdings; user reserve can remove only target',async()=>{
 const env=setup();env.COCKPIT_KV.map.set(KEYS.discipline,JSON.stringify({positions:[{symbol:'MSTR',market:'us'},{symbol:'SMCI',market:'us'}]}));
 await Promise.allSettled(Array.from({length:30},()=>use(env,'background',32)));
 const scope=scopedStorage(env,'user');await mutatePosition(scope.env,{action:'remove_position',symbol:'MSTR'});await scope.finish();
 assert.deepEqual(JSON.parse(await env.COCKPIT_KV.get(KEYS.discipline)).positions.map(x=>x.symbol),['SMCI']);
 await Promise.allSettled(Array.from({length:5},()=>use(env,'user',32)));
 const blocked=scopedStorage(env,'user');await assert.rejects(mutatePosition(blocked.env,{action:'remove_position',symbol:'SMCI'}));
 assert.equal(JSON.parse(await env.COCKPIT_KV.get(KEYS.discipline)).positions[0].symbol,'SMCI');
});
test('explicit refresh never spends management reserve; ordinary GET never persists',()=>{
 const req=(path,method='GET')=>new Request('https://app'+path,{method});
 assert.equal(requestLane(req('/api/watchlist')),'read');
 assert.equal(requestLane(req('/api/watchlist','POST'),{action:'refresh_stage'}),'analysis');
 assert.equal(requestLane(req('/api/watchlist','POST'),{action:'update'}),'user');
 assert.equal(requestLane(req('/api/stage-run?batch=jp1')),'analysis');
 assert.equal(requestLane(req('/api/positions','POST'),{action:'toggle_held'}),'user');
});

test('one invocation renews leases beyond 32 concurrent writes without overspending',async()=>{
 const env=setup(),scope=scopedStorage(env,'background');
 await Promise.all(Array.from({length:80},(_,i)=>scope.env.COCKPIT_KV.put('data:'+i,'value')));
 await scope.finish();assert.equal(env.COCKPIT_KV.writes,80);
 assert.equal((await budgetStatus(env)).used.background,80);
});
test('scheduler heartbeat and cooldown remain writable after KV budget exhaustion',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T20:00:00Z')});
 const env=setup();await assert.rejects(use(env,'background',551));
 const scope=scopedStorage(env,'background');
 for(let i=0;i<100;i++)await scope.env.COCKPIT_KV.put('system:scheduler-health:v1',JSON.stringify({last_cron_at:new Date().toISOString()}));
 await scope.env.COCKPIT_KV.put('sched:test:cooldown','failed',{expirationTtl:1800});
 assert.equal(await scope.env.COCKPIT_KV.get('sched:test:cooldown'),'failed');
 t.mock.timers.tick(1800000);
 assert.equal(await scope.env.COCKPIT_KV.get('sched:test:cooldown'),null);
 assert.ok(await scope.env.COCKPIT_KV.get('system:scheduler-health:v1'));
 await scope.finish();assert.equal(env.COCKPIT_KV.writes,350);
 t.mock.timers.tick(4*3600000);
 await use(env,'background',2);assert.equal((await budgetStatus(env)).used.background,2);
});
test('read-only requests cannot persist coordination; legacy deleted markers cannot resurrect',async()=>{
 const env=setup();env.COCKPIT_KV.map.set('sched:old','old');
 const scope=scopedStorage(env,'background');assert.equal(await scope.env.COCKPIT_KV.get('sched:old'),null);
 await scope.env.COCKPIT_KV.put('sched:old','new');await scope.env.COCKPIT_KV.delete('sched:old');await scope.finish();
 const read=scopedStorage(env,'read');await read.env.COCKPIT_KV.put('sched:old','overlay');await read.finish();
 const next=scopedStorage(env,'read');assert.equal(await next.env.COCKPIT_KV.get('sched:old'),null);await next.finish();
 assert.equal(env.COCKPIT_KV.writes,0);
});

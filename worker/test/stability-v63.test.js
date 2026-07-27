import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scheduleNodes } from '../src/index.js';
import { SCHEDULE_VERSION } from '../src/config.js';
import { getSchedulerHealth, updateSchedulerHealth, recordSchedulerJob } from '../src/services/system-health.js';

function mockEnv(){
  const values=new Map();
  return{
    COCKPIT_KV:{
      async get(key){return values.has(key)?values.get(key):null},
      async put(key,value){values.set(key,String(value))}
    }
  };
}

test('stable schedule markers use the current release identity',()=>{
  assert.equal(SCHEDULE_VERSION,'sched-v63-stable');
  const keys=scheduleNodes(new Date('2026-07-27T07:00:00Z')).nodes.map(x=>x.key);
  assert.ok(keys.some(key=>key.startsWith('jp_1535')));
  assert.ok(keys.some(key=>key.startsWith('jp_1735_retry2')));
});

test('scheduler health persists success and failure details',async()=>{
  const env=mockEnv();
  await updateSchedulerHealth(env,{last_tick_at:'2026-07-27T00:00:00.000Z'});
  await recordSchedulerJob(env,{key:'jp_1535:b1',action:'stage',market:'jp',tradeDate:'2026-07-27'},'error',new Error('provider delay'));
  let health=await getSchedulerHealth(env);
  assert.equal(health.jobs['jp_1535:b1'].status,'error');
  assert.equal(health.jobs['jp_1535:b1'].failures,1);
  await recordSchedulerJob(env,{key:'jp_1535:b1',action:'stage',market:'jp',tradeDate:'2026-07-27'},'ok');
  health=await getSchedulerHealth(env);
  assert.equal(health.jobs['jp_1535:b1'].status,'ok');
  assert.equal(health.jobs['jp_1535:b1'].failures,0);
});

test('service worker uses network first for mutable application files',()=>{
  const sw=fs.readFileSync(path.resolve('../public/sw.js'),'utf8');
  assert.match(sw,/destination==='script'/);
  assert.match(sw,/cache:'no-store'/);
  assert.doesNotMatch(sw,/caches\.match\(request\)\.then\(hit=>hit\|\|fetch/);
});

test('frontend is distributed as one frozen runtime bundle',()=>{
  const index=fs.readFileSync(path.resolve('../public/index.html'),'utf8');
  const runtime=fs.readFileSync(path.resolve('../public/vantage-runtime-v63.js'),'utf8');
  assert.match(index,/vantage-runtime-v63\.js/);
  assert.doesNotMatch(index,/navigation-v55\.js\?v=/);
  for(const name of ['vantage-frame-sync-v49.js','navigation-v55.js','event-mobile-v59.js']){
    assert.ok(runtime.includes(name));
  }
  assert.match(index,/function eventShortDate\(value\)/);
  assert.match(index,/updateViaCache:'none'/);
});

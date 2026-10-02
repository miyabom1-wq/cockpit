import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MockKV} from './helpers.js';
import worker from '../src/index.js';
import {budgetTestEnv} from './budget-fixture.js';
import {ECONOMIC_KEY,ECONOMIC_CRON,SOURCES,PARSERS,syncEconomicEvents,getEconomicEvents,normalizeRows,zonedTime,parseBls} from '../src/services/economic-events.js';
const now=Date.parse('2026-09-21T12:00:00Z');
const bls=`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Consumer Price Index\r\nDTSTART;TZID=America/New_York:20261014T083000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Employment Situation\r\nDTSTART:20261106T133000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Producer Price Index\r\nDTSTART:20261106T133000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const fixtures={bls};
for(const [key,ext] of Object.entries({bea:'json',fed:'html',boj:'html',jp:'xml',ecb:'html'}))fixtures[key]=readFileSync(new URL(`fixtures/economic/${key}.${ext}`,import.meta.url),'utf8');
const load=async url=>fixtures[Object.keys(SOURCES).find(key=>SOURCES[key]===url)];
test('actual BLS ICS uses US-Eastern and supplies all six remaining releases',()=>{
 const raw=readFileSync(new URL('fixtures/economic/bls.ics',import.meta.url),'utf8');
 const rows=normalizeRows(parseBls(raw),now);assert.equal(rows.length,6);
 assert.deepEqual(rows[0],['nfp','2026-10-02T12:30:00.000Z']);assert.deepEqual(rows.at(-1),['cpi','2026-12-10T13:30:00.000Z']);
});
test('official captures parse upcoming schedules, exclusion, and UTC/JST boundaries',()=>{
 const expected={bls:2,bea:8,fed:4,boj:2,jp:3,ecb:4};
 for(const [key,parser] of Object.entries(PARSERS))assert.equal(normalizeRows(parser(fixtures[key]),now).filter(r=>Date.parse(r[1])>=now).length,expected[key],key);
 assert.ok(PARSERS.fed(fixtures.fed).some(r=>r[1].startsWith('2027-')));
 assert.ok(PARSERS.boj(fixtures.boj).some(r=>r[1].startsWith('2027-')));
 assert.deepEqual(normalizeRows(PARSERS.boj(fixtures.boj),now).find(r=>Date.parse(r[1])>=now),['boj','2026-10-30']);
 assert.equal(normalizeRows(PARSERS.jp(fixtures.jp),now).find(r=>Date.parse(r[1])>=now)[1],'2026-10-22T23:30:00.000Z');
});
test('US/European DST, rollover and invalid dates',()=>{
 assert.equal(zonedTime('2026-10-28','14:00','America/New_York'),'2026-10-28T18:00:00.000Z');
 assert.equal(zonedTime('2026-12-09','14:00','America/New_York'),'2026-12-09T19:00:00.000Z');
 assert.equal(zonedTime('2026-07-23','14:15','Europe/Berlin'),'2026-07-23T12:15:00.000Z');
 assert.equal(zonedTime('2026-10-29','14:15','Europe/Berlin'),'2026-10-29T13:15:00.000Z');
 assert.throws(()=>zonedTime('2026-02-30','08:30','Asia/Tokyo'));
 assert.equal(parseBls(bls.replace('Consumer Price Index','Consumer Price \r\n Index')).length,2);
 assert.throws(()=>parseBls('<html>Access Denied</html>'));
});
test('one compact key, unchanged sync zero writes, changed source replaces old event',async()=>{
 const kv=new MockKV({'events':'manual','events:earnings:v2:MSFT':'earnings'}),env={COCKPIT_KV:kv};
 const report=await syncEconomicEvents(env,{now,load});assert.equal(report.ok,true);assert.equal(kv.writes,1);assert.ok(report.bytes<2000);
 await syncEconomicEvents(env,{now:now+1000,load});assert.equal(kv.writes,1);
 await syncEconomicEvents(env,{now,load:async url=>(await load(url)).replace('20261014T083000','20261015T083000')});
 assert.equal(kv.writes,2);assert.ok(!kv.map.get(ECONOMIC_KEY).includes('2026-10-14'));assert.equal(kv.map.get('events'),'manual');assert.equal(kv.map.get('events:earnings:v2:MSFT'),'earnings');assert.equal(kv.map.size,3);
});
test('source errors and partial malformed feeds preserve last good rows; failed reads isolate earnings',async()=>{
 const kv=new MockKV(),env={COCKPIT_KV:kv};await syncEconomicEvents(env,{now,load});
 const before=kv.map.get(ECONOMIC_KEY);
 const report=await syncEconomicEvents(env,{now,load:async()=>{throw Error('HTTP 403')}});
 assert.equal(report.ok,false);assert.equal(kv.map.get(ECONOMIC_KEY),before);assert.equal(kv.writes,1);
 await syncEconomicEvents(env,{now,load:async url=>url===SOURCES.bls?bls.replace('Employment Situation','Other release'):load(url)});
 assert.equal(kv.map.get(ECONOMIC_KEY),before);
 assert.deepEqual(await getEconomicEvents({COCKPIT_KV:{get:async()=>{throw Error('KV unavailable')}}},now),[]);
});
test('bootstrap, all macro kinds survive, date-only stays visible through JST date and expires',async()=>{
 const env={COCKPIT_KV:new MockKV()};const events=await getEconomicEvents(env,now);
 assert.equal(events.length,27);assert.equal(env.COCKPIT_KV.writes,0);
 const day=events.find(x=>x.official_kind==='economic'&&x.date_only);assert.equal(day.time_note,'時刻未定');
 assert.equal(events.find(x=>x.name.startsWith('日本 CPI')).event_date,'2026-10-23');
 assert.equal(events.find(x=>x.name.startsWith('日本 CPI')).time_note,'08:30 JST');
 assert.ok((await getEconomicEvents(env,Date.parse('2026-10-30T14:59:00Z'))).some(x=>x.event_date==='2026-10-30'));
 assert.ok(!(await getEconomicEvents(env,Date.parse('2026-11-06T15:00:00Z'))).some(x=>x.event_date==='2026-10-30'));
 assert.equal(normalizeRows([['boj','2028-01-01'],['boj','2025-01-01']],now).length,0);
});
test('daily cron never invokes existing market/earnings jobs',async()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(config,/crons\s*=\s*\[[^\]]*"17 20 \* \* \*"/);
 assert.match(config,/class_name\s*=\s*"WriteBudget"/);
 const old=globalThis.fetch;globalThis.fetch=async url=>new Response(await load(url));
 try{
  const env=budgetTestEnv(),kv=env.COCKPIT_KV,reads=[],original=kv.get.bind(kv);kv.get=async key=>{reads.push(key);return original(key)};
  const tasks=[];await worker.scheduled({cron:ECONOMIC_CRON,scheduledTime:now},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);
  assert.deepEqual(reads,[ECONOMIC_KEY]);assert.equal(kv.map.size,1);assert.equal(kv.writes,1);
  const repeat=[];await worker.scheduled({cron:ECONOMIC_CRON,scheduledTime:now},env,{waitUntil:p=>repeat.push(p)});await Promise.all(repeat);assert.equal(kv.writes,1);
 }finally{globalThis.fetch=old;}
});
test('existing event UI renders JST and unknown BOJ time with the same section/classes',async()=>{
 const events=await getEconomicEvents({COCKPIT_KV:new MockKV()},now),root={innerHTML:''};
 const ui=readFileSync(new URL('../../public/events-ui.js',import.meta.url),'utf8');
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context={Date:FixedDate,window:{innerWidth:1000},state:{events:{events}},document:{getElementById:id=>id==='event-list'?root:{},querySelectorAll:()=>[],addEventListener:()=>{}},esc:String,dateText:String,setTimeout:()=>{},setInterval:()=>{},MutationObserver:class{observe(){}},console};
 context.queueMicrotask=()=>{};context.window.addEventListener=()=>{};vm.createContext(context);vm.runInContext(ui,context);context.window.renderEvents();
 context.state.events.events=events.filter(e=>e.event_date>='2026-10-19');
 root.onclick({target:{closest:()=>({dataset:{eventPeriod:'later'}})}});
 assert.match(root.innerHTML,/今後/);assert.match(root.innerHTML,/22:15 JST/);assert.match(root.innerHTML,/10\/23\(金\)/);assert.match(root.innerHTML,/時刻未定/);assert.match(root.innerHTML,/欧州/);assert.match(root.innerHTML,/公式 ★★★/);
});

test('released NFP remains visible for seven days, including across Monday',async()=>{
 const release='2026-10-02T12:30:00.000Z',t=Date.parse(release);
 const env={COCKPIT_KV:new MockKV({[ECONOMIC_KEY]:JSON.stringify({v:1,rows:[['nfp',release]]})})};
 assert.equal((await getEconomicEvents(env,t+2*3600000)).length,1);
 assert.equal((await getEconomicEvents(env,t+3*86400000)).length,1);
 assert.equal((await getEconomicEvents(env,t+7*86400000)).length,1);
 assert.equal((await getEconomicEvents(env,t+7*86400000+1)).length,0);
});
test('successful source refresh preserves recently released rows omitted by source',async()=>{
 const release='2026-10-02T12:30:00.000Z',t=Date.parse(release)+3600000;
 const env={COCKPIT_KV:new MockKV({[ECONOMIC_KEY]:JSON.stringify({v:1,rows:[['nfp',release]]})})};
 await syncEconomicEvents(env,{now:t,load});
 assert.ok((await getEconomicEvents(env,t)).some(e=>e.time===release));
});

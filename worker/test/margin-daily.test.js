import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedMarginDate, marginFreshness, evaluateMarginSupply, enrichMarginSupply, getMarginDataset, MARGIN_DATA_SCHEMA } from '../src/services/margin-supply.js';
import { MockKV } from './helpers.js';
const now=new Date('2026-09-30T09:00:00Z');
const item={daily:{as_of:'2026-09-29',buy_balance:800000,sell_balance:400000,buy_change_pct:-30,buy_5d_change_pct:null},flags:{}};
const dataset={schema:MARGIN_DATA_SCHEMA,daily:{as_of:'2026-09-29'},generated_at:now.toISOString(),items:{'7203.T':item}};
test('publication clock respects previous business day, weekends, and Japanese holidays',()=>{
 for(const [time,date] of [['2026-09-30T06:59:00Z','2026-09-28'],['2026-09-30T07:00:00Z','2026-09-29'],['2026-10-03T09:00:00Z','2026-10-01'],['2026-10-12T09:00:00Z','2026-10-08'],['2026-09-24T07:00:00Z','2026-09-18']]) assert.equal(expectedMarginDate(new Date(time)),date);
});
test('regenerating stale balances cannot make them fresh; unknown and future dates fail closed',()=>{
 for(const as_of of [undefined,'2026-09-18','2026-10-01']) assert.equal(marginFreshness({...dataset,daily:{as_of}},now).stale,true);
 assert.equal(marginFreshness(dataset,now).stale,false);
});
test('daily change is not substituted for five-day momentum; ratio is recalculated',()=>{
 const s=evaluateMarginSupply({ret5:10,avg_volume20:1000000},{...item,daily:{...item.daily,ratio:999}},{now});
 assert.equal(s.buy_day_change_pct,-30);assert.equal(s.buy_5d_change_pct,null);assert.equal(s.ratio,2);
 assert.ok(!s.reasons.some(x=>x.includes('同時進行')));assert.match(s.summary,/比較不能/);
});
test('stale row date is rejected even within a fresh dataset',()=>{
 const s=evaluateMarginSupply({}, {...item,daily:{...item.daily,as_of:'2026-09-18'}},{now,dataset});
 assert.equal(s.stale,true);
});
test('stale balances lose old positive reasons and ranking boost but keep restriction flags',()=>{
 const stale={...dataset,daily:{as_of:'2026-09-18'},items:{'7203.T':{...item,daily:{...item.daily,as_of:'2026-09-18'}}}};
 const row={market:'jp',symbol:'7203.T',rs_percentile:60,entry_lane:'A',entry_reason:['信用需給: 古い改善','価格条件'],risk_reason:[]};
 enrichMarginSupply([row],stale,{now});assert.equal(row.supply_score,0);assert.equal(row.entry_sort_score,60);assert.deepEqual(row.entry_reason,['価格条件']);assert.equal(row.entry_lane,'A');
 const s=evaluateMarginSupply({}, {...stale.items['7203.T'],flags:{margin_restriction:true}},{now});assert.equal(s.add_blocked,true);
});
test('zero short balance and missing values never produce infinity or a false zero',()=>{
 const s=evaluateMarginSupply({}, {...item,daily:{...item.daily,sell_balance:0}},{now});assert.equal(s.ratio,null);
});
test('KV strips source history and repeated unchanged refresh does not write',async()=>{
 const original=globalThis.fetch,kv=new MockKV();let writes=0;const put=kv.put.bind(kv);kv.put=async(...args)=>{writes++;return put(...args)};
 globalThis.fetch=async()=>Response.json({...dataset,items:{'7203.T':{...item,history:[{as_of:'2026-09-29'}]}}});
 try {await getMarginDataset({COCKPIT_KV:kv},{force:true});await getMarginDataset({COCKPIT_KV:kv},{force:true});assert.equal(writes,1);assert.equal(JSON.parse(await kv.get('margin:supply:v1')).items['7203.T'].history,undefined);
 globalThis.fetch=async()=>{throw Error('offline')};const d=await getMarginDataset({COCKPIT_KV:kv},{force:true});assert.match(d.cache_warning,/offline/);assert.ok(d.worker_synced_at);
 }finally{globalThis.fetch=original}
});
test('bundled release migrates when remote still serves legacy schema; date remains authoritative',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({schema:'jp-margin-v1',items:{}});
 const kv=new MockKV();
 try{
  const d=await getMarginDataset({COCKPIT_KV:kv,ASSETS:{fetch:async()=>Response.json(dataset)}},{force:true});
  assert.equal(d.schema,MARGIN_DATA_SCHEMA);assert.equal(d.daily.as_of,'2026-09-29');assert.equal(d.worker_sync_source,'bundled-jpx-snapshot');
 }finally{globalThis.fetch=original;}
});

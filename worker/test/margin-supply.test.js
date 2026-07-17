import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMarginSupply, enrichMarginSupply, getMarginDataset, MARGIN_DATA_SCHEMA } from '../src/services/margin-supply.js';
import { MockKV } from './helpers.js';

function item({buy=1000000,sell=100000,buyChange=100000,sellChange=0,flags={}}={}){
  return{weekly:{as_of:'2026-07-10',published_at:'2026-07-14T07:30:00Z',buy_balance:buy,sell_balance:sell,buy_change:buyChange,sell_change:sellChange,buy_change_pct:buyChange/(buy-buyChange)*100,sell_change_pct:0,ratio:sell?buy/sell:null,buy_4w_change_pct:20},flags};
}
function analysis(overrides={}){return{symbol:'285A.T',name:'キオクシア',market:'jp',ret5:-8,avg_volume20:200000,entry_lane:'C',entry_reason:['25日線近辺'],risk_reason:[],rs_percentile:70,audit:{},...overrides};}

test('falling price, rising buy balance and heavy turnover is supply warning',()=>{
  const s=evaluateMarginSupply(analysis(),item());
  assert.equal(s.label,'需給警戒');
  assert.ok(s.score<=-18);
  assert.equal(s.buy_turnover_days,5);
  assert.ok(s.cautions.some(x=>x.includes('株価下落中')));
});

test('rising price with falling buy balance is supply improvement',()=>{
  const s=evaluateMarginSupply(analysis({ret5:7,avg_volume20:2000000}),item({buy:800000,sell:500000,buyChange:-200000}));
  assert.ok(['需給改善','需給追い風'].includes(s.label));
  assert.ok(s.score>0);
  assert.ok(s.reasons.some(x=>x.includes('同時進行')));
});

test('daily publication is caution, not a margin restriction or hard stop',()=>{
  const s=evaluateMarginSupply(analysis({ret5:1,avg_volume20:2000000}),item({buy:500000,sell:300000,buyChange:0,flags:{daily_disclosure:true}}));
  assert.equal(s.flags.daily_disclosure,true);
  assert.equal(s.flags.margin_restriction,undefined);
  assert.equal(s.add_blocked,false);
});

test('margin enrichment adjusts sort score but never changes A/B/C lane',()=>{
  const row=analysis({entry_lane:'A',rs_percentile:82});
  const dataset={schema:MARGIN_DATA_SCHEMA,items:{'285A.T':item()}};
  enrichMarginSupply([row],dataset);
  assert.equal(row.entry_lane,'A');
  assert.ok(Number.isFinite(row.entry_sort_score));
  assert.equal(row.supply_label,'需給警戒');
});

test('official dataset fetch is cached in KV',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return new Response(JSON.stringify({schema:MARGIN_DATA_SCHEMA,generated_at:new Date().toISOString(),weekly:{as_of:'2026-07-10',count:1},items:{'285A.T':item()}}),{status:200,headers:{'content-type':'application/json'}})};
  try{
    const env={COCKPIT_KV:new MockKV()};
    const first=await getMarginDataset(env,{force:true});
    const second=await getMarginDataset(env);
    assert.equal(first.weekly.count,1);
    assert.equal(second.weekly.count,1);
    assert.equal(calls.length,1);
    assert.ok(env.COCKPIT_KV.map.has('margin:supply:v1'));
  }finally{globalThis.fetch=original;}
});

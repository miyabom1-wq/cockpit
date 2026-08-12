import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeSnapshotFromStages } from '../src/services/theme-history.js';
import { marginDatasetFreshForTradeDate, marginGeneratedJstDate, MARGIN_DATA_SCHEMA } from '../src/services/margin-supply.js';
import { scheduleNodes } from '../src/index.js';

function row(symbol,market,entry_lane,rs5,rs20,ret5,extra={}){
  return{symbol,name:symbol,market,entry_lane,rs5,rs20,ret5,change_pct:ret5,effective_vol_ratio:1.2,rsi14:58,div25:2,...extra};
}
function stage(market,rows){return{market,complete:true,kind:'confirmed',trade_date:'2026-08-12',snapshot_id:`${market}-2026-08-12`,stocks:Object.fromEntries(rows.map(x=>[x.symbol,x]))};}

test('strong E-lane theme is overheat, not breakdown',()=>{
  const jp=stage('jp',['5803.T','5801.T','5802.T'].map(s=>row(s,'jp','E',6,3,5,{rsi14:80})));
  const us=stage('us',['VRT','ETN','GEV'].map(s=>row(s,'us','E',6,3,5,{rsi14:80})));
  const t=buildThemeSnapshotFromStages(jp,us,'2026-08-12').themes['電線・AI物理'];
  assert.equal(t.code,'OVERHEAT');assert.equal(t.label,'過熱');assert.ok(t.overheatERate>=.3);assert.equal(t.weakERate,0);
});

test('weak E-lane theme with negative RS still breaks down',()=>{
  const us=stage('us',['MU','SNDK','WDC','STX'].map(s=>row(s,'us','E',-6,-5,-4)));
  const t=buildThemeSnapshotFromStages({},us,'2026-08-12').themes['メモリ・ストレージ'];
  assert.equal(t.code,'BREAKDOWN');assert.equal(t.label,'崩壊');assert.ok(t.weakERate>=.3);
});

test('tiny theme sample is held instead of assertive breakdown',()=>{
  const jp=stage('jp',[row('9999.T','jp','E',-8,-6,-5,{theme:'鉄鋼'})]);
  const t=buildThemeSnapshotFromStages(jp,{},'2026-08-12').themes['鉄鋼'];
  assert.equal(t.code,'WAIT');assert.equal(t.label,'判定保留');assert.ok(t.confidence<35);
});

test('margin freshness uses generated_at JST date',()=>{
  const current={schema:MARGIN_DATA_SCHEMA,generated_at:'2026-08-12T10:43:27Z',items:{}};
  const old={schema:MARGIN_DATA_SCHEMA,generated_at:'2026-08-11T10:43:27Z',items:{}};
  assert.equal(marginGeneratedJstDate(current),'2026-08-12');
  assert.equal(marginDatasetFreshForTradeDate(current,'2026-08-12'),true);
  assert.equal(marginDatasetFreshForTradeDate(old,'2026-08-12'),false);
});

test('JP margin scheduler retries within a three-hour window',()=>{
  const nodes=scheduleNodes(new Date('2026-08-12T10:10:00.000Z')).nodes;
  const margin=nodes.find(x=>x.key==='jp_1910_margin');
  assert.ok(margin);assert.equal(margin.window,180);assert.equal(margin.action,'margin');
});

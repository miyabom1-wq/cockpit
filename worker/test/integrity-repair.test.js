import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMacroSnapshots, evaluateRiskGate, providerSymbolMatches } from '../src/services/integrity.js';
import { getWatchlist } from '../src/services/watchlist.js';
import { getStage } from '../src/services/stage.js';
import { MockKV } from './helpers.js';

test('shared macro merge selects one newest observation for overlapping indices',()=>{
  const older={'韓国KOSPI':{date:'2026-07-16',change_pct:6.2,ret5:.5,fetched_at:'2026-07-16T20:00:00Z'}};
  const newer={'韓国KOSPI':{date:'2026-07-16',change_pct:-6.4,ret5:-6.5,fetched_at:'2026-07-17T05:20:00Z'}};
  const merged=mergeMacroSnapshots(older,newer);
  assert.equal(merged['韓国KOSPI'].change_pct,-6.4);
});

test('crash conditions force stress gate and block new A/B entries',()=>{
  const macro={
    '日経平均':{date:'2026-07-17',change_pct:-5.5,ret5:-7.9},
    'SOX':{date:'2026-07-16',change_pct:-4.3,ret5:-8.4},
    '韓国KOSPI':{date:'2026-07-16',change_pct:-6.4,ret5:-6.5},
    'VIX':{date:'2026-07-16',change_pct:6.8,ret5:5.6}
  };
  const gate=evaluateRiskGate('jp',macro);
  assert.equal(gate.level,'stress');
  assert.equal(gate.block_new_entries,true);
  assert.ok(gate.reasons.some(x=>x.includes('日経平均')));
});

test('provider symbol integrity rejects ADR substitution',()=>{
  assert.equal(providerSymbolMatches('7267.T','7267.T'),true);
  assert.equal(providerSymbolMatches('7267.T','HMC'),false);
});

test('watchlist separates current data, legacy memo status and actual holding state',async()=>{
  const watch=[{id:'w1',symbol:'8136.T',name:'サンリオ',market:'jp',status:'holding',memo:'過去シグナル +8%',source:'candidate',added_at:'2026-07-01T00:00:00Z'}];
  const stage={market:'jp',complete:true,updated_at:'2026-07-17T05:20:00Z',macro:{},stocks:{'8136.T':{symbol:'8136.T',name:'サンリオ',market:'jp',price:100,change_pct:-4,price_time:'2026-07-17T05:20:00Z',entry_lane:'D'}}};
  const env={COCKPIT_KV:new MockKV({'watchlist:v1':JSON.stringify(watch),'stage:jp':JSON.stringify(stage),'discipline:state':JSON.stringify({positions:[]})})};
  const result=await getWatchlist(env),item=result.items[0];
  assert.equal(item.status,'tracking');
  assert.equal(item.legacy_status,'holding');
  assert.equal(item.held,false);
  assert.equal(item.current_data.change_pct,-4);
  assert.equal(item.memo,'過去シグナル +8%');
});

test('JP and US stage reads expose the same canonical KOSPI observation',async()=>{
  const jp={market:'jp',complete:true,updated_at:'2026-07-17T05:20:00Z',macro:{'韓国KOSPI':{date:'2026-07-16',change_pct:-6.4,ret5:-6.5,price_time:'2026-07-16T06:30:00Z'}},stocks:{}};
  const us={market:'us',complete:true,updated_at:'2026-07-16T20:04:00Z',macro:{'韓国KOSPI':{date:'2026-07-15',change_pct:6.2,ret5:.5,price_time:'2026-07-15T06:30:00Z'}},stocks:{}};
  const env={COCKPIT_KV:new MockKV({'stage:jp':JSON.stringify(jp),'stage:us':JSON.stringify(us)})};
  const [a,b]=await Promise.all([getStage(env,'jp'),getStage(env,'us')]);
  assert.equal(a.macro['韓国KOSPI'].change_pct,-6.4);
  assert.equal(b.macro['韓国KOSPI'].change_pct,-6.4);
  assert.equal(a.macro['韓国KOSPI'].date,b.macro['韓国KOSPI'].date);
});

import test from 'node:test';import assert from 'node:assert/strict';
import { MockKV } from './helpers.js';import { captureSignalLog, getSignalLog } from '../src/services/signal-log.js';
function stage(date,kind='confirmed',price=100){return{complete:true,kind,trade_date:date,snapshot_id:`JP-${date}`,close_verification:{ratio:kind==='confirmed'?100:0},stocks:{'1111.T':{symbol:'1111.T',name:'テスト',market:'jp',date,price,entry_lane:'A',entry_label:'強い継続候補',entry_reason:['test'],risk_reason:[],rs5:2,rs_percentile:80,data_quality:{data_valid:true,close_confirmed:kind==='confirmed'}}}};}
test('signal outcomes use confirmed closes only and same-day 0 is not recorded',async()=>{const kv=new MockKV({'stage:jp':JSON.stringify(stage('2026-07-13'))}),env={COCKPIT_KV:kv};let r=await captureSignalLog(env,'jp','test');assert.equal(r.ok,true);let log=await getSignalLog(env);assert.equal(log.items[0].outcomes.d1,undefined);kv.map.set('stage:jp',JSON.stringify(stage('2026-07-14','intraday',110)));r=await captureSignalLog(env,'jp','test');assert.equal(r.skipped,true);kv.map.set('stage:jp',JSON.stringify(stage('2026-07-14','confirmed',110)));await captureSignalLog(env,'jp','test');log=await getSignalLog(env);assert.equal(log.items[0].outcomes.d1.return_pct,10);});
test('invalid symbol data does not falsely end an active signal',async()=>{
  const first=stage('2026-07-13');
  const kv=new MockKV({'stage:jp':JSON.stringify(first)}),env={COCKPIT_KV:kv};
  await captureSignalLog(env,'jp','test');
  const broken=stage('2026-07-14');broken.stocks['1111.T'].data_quality={data_valid:false,close_confirmed:true,reasons:['取得失敗']};broken.stocks['1111.T'].entry_lane='D';
  kv.map.set('stage:jp',JSON.stringify(broken));await captureSignalLog(env,'jp','test');
  const log=await getSignalLog(env);assert.equal(log.items[0].active,true);assert.equal(log.items[0].condition_end_date,null);
});

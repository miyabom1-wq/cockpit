import test from 'node:test';
import assert from 'node:assert/strict';
import { MockKV } from './helpers.js';
import { KEYS } from '../src/storage/kv-schema.js';
import { buildThemeSnapshotFromStages, captureThemeSnapshot, getThemeHistory } from '../src/services/theme-history.js';
import { jstDate } from '../src/utils.js';

function row(symbol,entry_lane,rs5,rs20,ret5=2,extra={}){
  return{symbol,name:symbol,entry_lane,rs5,rs20,ret5,change_pct:ret5,effective_vol_ratio:1.3,rsi14:58,div25:3,...extra};
}
function stage(market,tradeDate,rows,macro={}){
  return{market,complete:true,kind:'confirmed',trade_date:tradeDate,snapshot_id:`${market}-${tradeDate}`,stocks:Object.fromEntries(rows.map(x=>[x.symbol,x])),macro};
}

test('world theme metrics give Japan and US equal regional weight',()=>{
  const jp=stage('jp','2026-07-16',[
    row('285A.T','E',-8,-6,-5),row('8035.T','E',-6,-5,-4),row('6857.T','D',-4,-3,-2),row('6146.T','D',-2,-2,-1)
  ]);
  const us=stage('us','2026-07-16',[
    row('MU','A',8,5,6),row('SNDK','B',6,3,5)
  ]);
  const s=buildThemeSnapshotFromStages(jp,us,'2026-07-17');
  const memory=s.themes['メモリ・ストレージ'];
  assert.equal(memory.jp.n,1);
  assert.equal(memory.us.n,2);
  assert.equal(memory.rs5,-0.5); // (-8 + average(8,6)) / 2
  assert.equal(memory.propagation,'米国先行・日本未追随');
});

test('captureThemeSnapshot upserts one record per JST date',async()=>{
  const date=jstDate();
  const jp=stage('jp','2026-07-16',[row('285A.T','B',3,-1,2)]);
  const us=stage('us','2026-07-16',[row('MU','A',5,2,3)]);
  const env={COCKPIT_KV:new MockKV({[KEYS.stage('jp')]:JSON.stringify(jp),[KEYS.stage('us')]:JSON.stringify(us)})};
  const a=await captureThemeSnapshot(env,'test');
  const b=await captureThemeSnapshot(env,'test2');
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  const saved=JSON.parse(await env.COCKPIT_KV.get(KEYS.themeHistory));
  assert.equal(saved.length,1);
  assert.equal(saved[0].date,date);
  assert.equal(saved[0].source,'test2');
});

test('theme history reports phase transition and score acceleration',async()=>{
  const today=jstDate();
  const priorDate=new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  const jp=stage('jp',today,[row('285A.T','A',6,2,5),row('8035.T','B',4,1,3)]);
  const us=stage('us',today,[row('MU','A',7,3,5),row('SNDK','B',5,2,4)]);
  const prior={date:priorDate,captured_at:`${priorDate}T08:00:00.000Z`,themes:{'メモリ・ストレージ':{code:'RECOVERY',label:'修復',score:2}}};
  const env={COCKPIT_KV:new MockKV({
    [KEYS.stage('jp')]:JSON.stringify(jp),[KEYS.stage('us')]:JSON.stringify(us),[KEYS.themeHistory]:JSON.stringify([prior])
  })};
  const d=await getThemeHistory(env,30);
  const memory=d.current.themes['メモリ・ストレージ'];
  assert.equal(memory.code,'EXPANSION');
  assert.equal(memory.transition,'修復→拡大');
  assert.ok(memory.change.d1>0);
  assert.ok(d.alerts.some(x=>x.theme==='メモリ・ストレージ'&&x.type==='transition'));
});

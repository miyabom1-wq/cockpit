import test from 'node:test';import assert from 'node:assert/strict';
import { rsiWilder, atrWilder, wilderRma } from '../src/indicators/wilder.js';
import { smaSeries } from '../src/indicators/moving-averages.js';
test('Wilder RMA seeds with SMA then recurses',()=>{const v=[1,2,3,4,5,6],r=wilderRma(v,3);assert.equal(r[2],2);assert.equal(r[3],(2*2+4)/3);});
test('RSI Wilder returns 100 for uninterrupted gains',()=>{const c=Array.from({length:30},(_,i)=>100+i),r=rsiWilder(c,14);assert.equal(r.at(-1),100);});
test('ATR Wilder uses true range',()=>{const rows=Array.from({length:20},(_,i)=>({high:102+i,low:100+i,close:101+i})),a=atrWilder(rows,14);assert.equal(a[13],2);assert.equal(a.at(-1),2);});
test('SMA exact',()=>{assert.deepEqual(smaSeries([1,2,3,4],3),[null,null,2,3]);});

test('intraday market curve converts partial volume to provisional full-day ratio',async()=>{
  const { marketVolumeCurveFraction, intradayAdjustedRatio } = await import('../src/engine/volume.js');
  const f=marketVolumeCurveFraction('jp',new Date('2026-07-16T01:00:00Z')); // 10:00 JST
  assert.ok(f>0&&f<1);assert.ok(intradayAdjustedRatio(.25,null,f)>.25);
});

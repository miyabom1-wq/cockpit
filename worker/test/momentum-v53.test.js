import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMomentum } from '../src/engine/momentum.js';
import { classifyCandidate } from '../src/engine/candidate-board.js';
import { prepareSeries, analyzePreparedAt } from '../src/engine/analysis.js';
import { benchmarkValues } from '../src/engine/relative-strength.js';
import { newMomentumStudy, recordMomentumStudy, summarizeMomentumStudy } from '../src/engine/momentum-study.js';
import { syntheticRows } from './helpers.js';
const base={price:120,open:116,high:121,low:115,sma5:116,sma25:100,atr14:4,div25:20,rsi14:85,rs5:6,rs20:4,change_pct:3,vol_ratio:1.4,effective_vol_ratio:1.4,close_pos:.83,upper_ratio:.17,regime:{code:'S2'},data_quality:{data_valid:true},close_confirmed:true};
function run(over={},features={}){const a={...base,...over};Object.assign(a,evaluateMomentum(a,{priorHigh20:119,priorLow10:108,rs5Delta:.5,tightBase:false,...features}));return{a,c:classifyCandidate(a)};}
// Named scenario fixtures represent requested price structures; NOT live quotes.
for(const [symbol,div] of [['SMCI',10.4],['6857.T',19.8],['6146.T',15],['5803.T',8.3],['6920.T',12],['5016.T',1.4]])test(`${symbol} synthetic healthy expansion ${div}% remains eligible`,()=>{
 const {a,c}=run({symbol,div25:div,sma25:120/(1+div/100)});
 assert.equal(c.lane,'A');assert.equal(a.momentumState,'acceleration');assert.equal(a.holdingAssessment,'HOLD');assert.equal(a.climaxRisk,'none');
});
test('RSI 95 and +9% alone cannot exclude A',()=>assert.equal(run({rsi14:95,change_pct:9}).c.lane,'A'));
test('extreme expansion with quiet intact trend is HOLD',()=>{const {a}=run({change_pct:.2,effective_vol_ratio:.8},{priorHigh20:125});assert.equal(a.momentumState,'continuation');assert.equal(a.holdingAssessment,'HOLD');assert.equal(a.entryAssessment,'SIZE_CAUTION')});
test('high volume breakout alone is not climax',()=>assert.equal(run({effective_vol_ratio:4}).a.climaxRisk,'none'));
test('extension alone without enough inputs does not produce HOLD',()=>{const {a}=run({price:null,sma5:null});assert.equal(a.momentumState,'unknown');assert.equal(a.holdingAssessment,'REVIEW')});
test('missing RS is explicitly limited and cannot confirm continuation',()=>{const {a}=run({rs5:null,change_pct:.2},{priorHigh20:125});assert.equal(a.momentumQuality,'limited');assert.equal(a.momentumState,'watch');assert.ok(a.momentumEvidence.missing.includes('rs5'))});
test('expansion + failed high + wick + exceptional volume warns',()=>{const {a,c}=run({price:118,high:125,close_pos:.2,upper_ratio:.6,effective_vol_ratio:3},{priorHigh20:120});assert.equal(a.momentumState,'climax');assert.equal(a.climaxRisk,'high');assert.equal(c.lane,'E');assert.equal(a.holdingAssessment,'REDUCE_REVIEW')});
test('5MA clear break and actual RS5 deterioration warn',()=>{const {a,c}=run({price:112,change_pct:-2},{priorHigh20:125,rs5Delta:-2});assert.equal(a.momentumState,'fading');assert.equal(c.lane,'E')});
test('support + 5MA + negative RS trigger breakdown',()=>{const {a,c}=run({price:94,rs5:-4,change_pct:-5,div25:-6},{priorLow10:96});assert.equal(a.momentumState,'breakdown');assert.equal(a.holdingAssessment,'EXIT_REVIEW');assert.equal(c.lane,'E')});
test('a tight base breakout is reacceleration',()=>assert.equal(run({}, {tightBase:true}).a.momentumState,'reacceleration'));
test('downside extension reversal remains B',()=>{const {a,c}=run({price:92,open:90,high:93,low:89,sma5:90,div25:-8,sma25:100,rs5:-1,setup:{code:'bottom_reversal',label:'反転初動'}},{priorHigh20:110,priorLow10:85,rs5Delta:1});assert.equal(a.extensionState,'downside');assert.equal(a.momentumState,'germination');assert.equal(c.lane,'B')});
test('invalid data never creates a candidate or HOLD',()=>{const {a,c}=run({data_quality:{data_valid:false}});assert.equal(c.lane,'D');assert.equal(a.momentumState,'unknown');assert.equal(a.holdingAssessment,'REVIEW')});
test('intraday analysis is explicitly provisional',()=>assert.equal(run({close_confirmed:false}).a.momentumProvisional,true));
for(const [div,state] of [[4.99,'normal'],[5,'extended'],[9.99,'extended'],[10,'strong'],[14.99,'strong'],[15,'extreme'],[-8,'downside'],[null,'unknown']])test(`extension boundary ${div}`,()=>assert.equal(run({div25:div}).a.extensionState,state));
test('ATR context reflects different volatility without changing direction',()=>{const low=run({atr14:2}),high=run({atr14:10});assert.equal(low.a.extensionRisk,'high');assert.equal(high.a.extensionRisk,'normal');assert.equal(low.c.lane,high.c.lane)});
test('future bars cannot change as-of classification',()=>{const rows=syntheticRows(280),bm=benchmarkValues(rows),o={symbol:'TEST',market:'us',benchmarkMap:bm,expectedDate:rows[250].date};const before=analyzePreparedAt(prepareSeries(rows.slice(0,251)),250,o);const future=rows.map((r,i)=>i>250?{...r,close:r.close*10,high:r.high*12}:r);assert.deepEqual(analyzePreparedAt(prepareSeries(future),250,o),before)});
test('5/10/20 studies use trading rows, preserve pending data and include E cohorts',()=>{const groups=newMomentumStudy(),p={rows:Array.from({length:11},(_,i)=>({close:100+i}))};const a={...run().a,date:'test',extensionState:'extreme',momentumState:'climax'};recordMomentumStudy(groups,p,0,a);const result=summarizeMomentumStudy(groups).cohorts.extreme_climax;assert.equal(result.count,1);assert.equal(result.returns[5].mean,5);assert.equal(result.returns[10].mean,10);assert.equal(result.returns[20].n,0);assert.equal(result.returns[20].mean,null)});
test('complete OHLC pipeline retains an extended breakout and exposes matching audit',()=>{
 const rows=syntheticRows(280),last=rows.at(-1),c=last.close*1.2;rows[279]={...last,open:c*.97,high:c*1.005,low:c*.965,close:c,volume:3000000};
 const bm=benchmarkValues(syntheticRows(280));const a=analyzePreparedAt(prepareSeries(rows),279,{symbol:'SMCI',market:'us',benchmarkMap:bm,expectedDate:last.date,closeConfirmed:true});
 assert.ok(a.div25>15);assert.ok(['A','B'].includes(a.entry_lane));assert.equal(a.momentumState,'reacceleration');assert.equal(a.holdingAssessment,'HOLD');assert.equal(a.audit.momentum.state,a.momentumState);assert.equal(a.setup_code,'reacceleration');
});

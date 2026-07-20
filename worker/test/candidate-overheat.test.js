import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCandidate } from '../src/engine/candidate-board.js';

test('treats a 10 percent 25-day extension as overheat, not a mild setup',()=>{
  const result=classifyCandidate({data_quality:{data_valid:true},regime:{code:'S2'},change_pct:2,effective_vol_ratio:1.4,close_pos:.8,rsi14:65,upper_ratio:.1,rs5:5,div25:10.4,ret20:8,setup:{label:'強い反転'}},{});
  assert.equal(result.lane,'E');
  assert.ok(result.risks.some(x=>x.includes('過熱')));
});

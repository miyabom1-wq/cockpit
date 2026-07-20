import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRiskGate } from '../src/services/integrity.js';

test('keeps stress but caps a delayed Korean confirmation of the same regional shock',()=>{
  const gate=evaluateRiskGate('jp',{
    '日経平均':{date:'2026-07-17',change_pct:-4.03,ret5:-6.4},
    '日経先物（CME円建て）':{date:'2026-07-20',change_pct:1.2,ret5:-4.1},
    '韓国KOSPI':{date:'2026-07-20',change_pct:-4.46,ret5:-6.5},
    'SOX':{date:'2026-07-17',change_pct:-4.3,ret5:-8.4},
    'VIX':{date:'2026-07-17',change_pct:6.8,ret5:5.6}
  });
  assert.equal(gate.level,'stress');
  assert.equal(gate.mixed_dates,true);
  assert.equal(gate.lagged_confirmation,true);
  assert.equal(gate.data_dates.kospi,'2026-07-20');
  assert.ok(gate.reasons.some(x=>x.includes('遅行確認')));
});

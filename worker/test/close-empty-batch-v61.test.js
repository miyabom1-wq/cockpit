import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFreshnessRatios, freshnessBelowFloor } from '../src/services/stage.js';

test('empty batches do not fail freshness floors',()=>{
  const f=batchFreshnessRatios([],'2026-07-24');
  assert.equal(f.total,0);
  assert.equal(freshnessBelowFloor(f,'confirmed_ratio',90),false);
  assert.equal(freshnessBelowFloor(f,'session_ratio',80),false);
});

test('non-empty stale batches still fail',()=>{
  const f=batchFreshnessRatios([{date:'2026-07-24',data_quality:{close_confirmed:false}}],'2026-07-24');
  assert.equal(freshnessBelowFloor(f,'confirmed_ratio',90),true);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestIntegrityFromCounts, classifyBacktestError, excludableBacktestCategory } from '../src/services/backtest.js';

test('124 failures out of 137 blocks the backtest result',()=>{
  const x=backtestIntegrityFromCounts(137,13,124,0,0);
  assert.equal(x.valid,false);
  assert.equal(x.success_rate,9.5);
});

test('90 percent successful coverage enables the result',()=>{
  const x=backtestIntegrityFromCounts(137,124,13,0,0);
  assert.equal(x.valid,true);
  assert.equal(x.success_rate,90.5);
});

test('pending retries prevent premature completion',()=>{
  const x=backtestIntegrityFromCounts(137,124,0,5,8);
  assert.equal(x.valid,false);
  assert.match(x.reason,/再試行/);
});

test('backtest errors are classified for diagnostics',()=>{
  assert.equal(classifyBacktestError(new Error('MU HTTP 429')),'rate_limit');
  assert.equal(classifyBacktestError(new Error('履歴不足 TEST: 120営業日')),'history_short');
  assert.equal(classifyBacktestError(new Error('fetch failed')),'network');
});


test('structurally ineligible symbols do not poison eligible coverage',()=>{
  const x=backtestIntegrityFromCounts(137,124,3,0,0,10);
  assert.equal(x.eligible,127);
  assert.equal(x.excluded,10);
  assert.equal(x.success_rate,97.6);
  assert.equal(x.valid,true);
});

test('empty benchmark/provider payload is retryable instead of permanent short history',()=>{
  assert.equal(classifyBacktestError(new Error('指数取得不完全 ^N225: 0営業日')),'provider_empty');
  assert.equal(classifyBacktestError(new Error('取得元空データ 285A.T')),'provider_empty');
});

test('history short and not found are explicit backtest exclusions',()=>{
  assert.equal(excludableBacktestCategory('history_short'),true);
  assert.equal(excludableBacktestCategory('not_found'),true);
  assert.equal(excludableBacktestCategory('symbol_mismatch'),false);
});

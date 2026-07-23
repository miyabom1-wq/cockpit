import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkValues, sanitizeBenchmarkRows } from '../src/engine/relative-strength.js';
import { eventCoverageSummary } from '../src/services/events.js';

test('benchmark values ignore sparse and invalid rows',()=>{
  const raw=[
    {date:'2026-01-01',close:100},
    undefined,
    null,
    {date:'',close:101},
    {date:'2026-01-02',close:102}
  ];
  const clean=sanitizeBenchmarkRows(raw);
  assert.equal(clean.length,2);
  assert.equal(clean[0].date,'2026-01-01');
  assert.doesNotThrow(()=>benchmarkValues(raw));
  assert.equal(benchmarkValues(raw).size,2);
});

test('event coverage separates found missing and unchecked symbols',()=>{
  const tracked=[
    {symbol:'1111.T',name:'A',market:'jp'},
    {symbol:'2222.T',name:'B',market:'jp'},
    {symbol:'NVDA',name:'NVIDIA',market:'us'}
  ];
  const automatic=[
    {category:'earnings',symbols:['1111.T'],source:'provider'}
  ];
  const coverage=eventCoverageSummary(
    tracked,
    automatic,
    new Set(['1111.T','2222.T']),
    '2026-07-24T00:00:00.000Z'
  );
  assert.equal(coverage.tracked_total,3);
  assert.equal(coverage.earnings_found,1);
  assert.equal(coverage.missing_total,1);
  assert.equal(coverage.unchecked_total,1);
  assert.equal(coverage.by_market.jp.found,1);
  assert.equal(coverage.by_market.us.unchecked,1);
});

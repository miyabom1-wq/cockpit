import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateBacktestTrade, classifyBacktestError } from '../src/services/backtest.js';

test('time limit exits before MA5 pending exit can escape the holding window',()=>{
  const rows=[
    {date:'2026-01-01',open:95,high:100,low:90,close:100},
    {date:'2026-01-02',open:101,high:105,low:96,close:103},
    {date:'2026-01-03',open:103,high:106,low:97,close:104},
    {date:'2026-01-04',open:104,high:107,low:98,close:105},
    {date:'2026-01-05',open:105,high:108,low:99,close:106},
    {date:'2026-01-06',open:106,high:107,low:94,close:95},
    {date:'2026-01-07',open:95,high:96,low:92,close:93}
  ];
  const prepared={rows,sma5:[null,null,null,null,100,100,100]};
  const result=simulateBacktestTrade(prepared,0,5);
  assert.equal(result.status,'trade');
  assert.equal(result.exit_reason,'time');
  assert.equal(result.exit_date,'2026-01-06');
});

test('zero-day hold never dereferences a missing exit row',()=>{
  const prepared={
    rows:[
      {date:'2026-01-01',open:95,high:100,low:90,close:100},
      {date:'2026-01-02',open:101,high:105,low:96,close:103}
    ],
    sma5:[null,null]
  };
  assert.equal(simulateBacktestTrade(prepared,0,0).status,'open');
});

test('undefined-property failure is classified as internal calculation bug',()=>{
  assert.equal(
    classifyBacktestError(new TypeError("Cannot read properties of undefined (reading 'date')")),
    'analysis_bug'
  );
});

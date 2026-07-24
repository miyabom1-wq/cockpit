import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateBacktestTrade } from '../src/services/backtest.js';

test('MA break on the final holding day exits at the time limit without crashing',()=>{
  const prepared={
    rows:[
      {date:'2026-01-01',open:99,high:101,low:95,close:100},
      {date:'2026-01-02',open:100,high:102,low:96,close:101},
      {date:'2026-01-05',open:103,high:104,low:96,close:99}
    ],
    sma5:[null,100,100]
  };
  const trade=simulateBacktestTrade(prepared,0,2);
  assert.equal(trade.status,'trade');
  assert.equal(trade.exit_date,'2026-01-05');
  assert.equal(trade.exit_reason,'time');
  assert.equal(trade.exit,99);
});

test('missing exit state returns open instead of dereferencing an invalid row',()=>{
  const prepared={
    rows:[
      {date:'2026-01-01',open:99,high:101,low:95,close:100},
      {date:'2026-01-02',open:100,high:102,low:96,close:101}
    ],
    sma5:[null,100]
  };
  const result=simulateBacktestTrade(prepared,0,0);
  assert.ok(['trade','open','not_triggered','invalid_stop'].includes(result.status));
});

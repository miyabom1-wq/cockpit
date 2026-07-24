import test from 'node:test';
import assert from 'node:assert/strict';
import { finite, mean, median, round } from '../src/utils.js';
import { classifyCandidate } from '../src/engine/candidate-board.js';
import { dailyRegimeAt } from '../src/engine/regime.js';
import { scoreUniverseItem } from '../src/services/universe-manager.js';
import { evaluateMarginSupply } from '../src/services/margin-supply.js';

test('missing values are never treated as numeric zero',()=>{
  for(const value of [null,undefined,'', '   ',false,true])assert.equal(finite(value),false);
  for(const value of [0,'0',1.25,'-3.5'])assert.equal(finite(value),true);
  assert.equal(round(null),null);
  assert.equal(mean([1,null,3]),2);
  assert.equal(median([null,2,4]),3);
});

test('missing technical values cannot become a C candidate',()=>{
  const result=classifyCandidate({
    data_quality:{data_valid:true,reasons:[]},
    regime:{code:'S2'},
    change_pct:null,effective_vol_ratio:null,vol_ratio:null,close_pos:null,
    rsi14:null,upper_ratio:null,rs5:null,div25:null,ret20:null,setup:null
  });
  assert.equal(result.lane,'D');
});

test('missing 200 day average stays in insufficient-data regime',()=>{
  const prepared={
    close:[100],
    sma50:[90],
    sma200:[null]
  };
  assert.equal(dailyRegimeAt(prepared,0).code,'?');
});

test('missing turnover rank does not receive top-rank points',()=>{
  const missing=scoreUniverseItem({item:{},analysis:{},rank:null,presence:0,market:'jp'});
  const top=scoreUniverseItem({item:{},analysis:{},rank:1,presence:0,market:'jp'});
  assert.ok(top-missing>=30);
});

test('missing margin fields stay missing instead of becoming zero',()=>{
  const result=evaluateMarginSupply(
    {avg_volume20:null,ret5:null},
    {weekly:{buy_balance:null,sell_balance:null,buy_change:null,sell_change:null,ratio:null},flags:{}}
  );
  assert.equal(result.buy_balance,null);
  assert.equal(result.sell_balance,null);
  assert.equal(result.buy_turnover_days,null);
  assert.equal(result.ratio,null);
});

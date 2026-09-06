import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';
import {authorized} from '../src/api/http.js';
import {finite,round,mean,median,pct} from '../src/utils.js';
import {smaSeries} from '../src/indicators/moving-averages.js';
import {rsiWilder,atrWilder} from '../src/indicators/wilder.js';
import {analyzeSeriesLatest} from '../src/engine/analysis.js';
import {normalizeYahooDaily} from '../src/data/normalization.js';
import {getPositions} from '../src/services/positions.js';
import {evaluateIndexTriggers} from '../src/services/push.js';
import {simulateBacktestTrade,backtestSeries} from '../src/services/backtest.js';
import {KEYS} from '../src/storage/kv-schema.js';
import {MockKV,syntheticRows,yahooResult} from './helpers.js';

test('requests without frontend context require a matching API token',()=>{
  for(const path of ['/api/export','/api/watchlist','/api/positions','/api/universe']){
    for(const headers of [{},{Origin:'https://unrelated.example'},{Origin:'http://localhost:8787'},{Referer:'https://unrelated.example/'}]){
      const request=new Request('https://example.com'+path,{headers});
      assert.equal(authorized(request,{WRITE_TOKEN:'secret'}),false,path);
      assert.equal(authorized(request,{}),false,path+' without configured token');
      assert.equal(authorized(new Request(request,{headers:{...headers,'X-Vantage-Key':'secret'}}),{WRITE_TOKEN:'secret'}),true,path);
    }
  }
});

test('unsupported mutation methods are rejected before touching storage, even with a token',async()=>{
  for(const method of ['PATCH','HEAD'])for(const token of [null,'secret']){
    const kv=new MockKV(),headers=token?{'X-Vantage-Key':token}:{};
    const request=new Request('https://example.com/api/universe',{method,headers,...(method==='PATCH'?{body:JSON.stringify({action:'config',mode:'off'})}:{})});
    const response=await worker.fetch(request,{COCKPIT_KV:kv,WRITE_TOKEN:'secret'});
    assert.equal(response.status,405);assert.ok(response.headers.get('Allow').includes('POST'));assert.equal(kv.writes,0);
  }
});

test('authorized settings update works and unauthorized POST cannot write',async()=>{
  const kv=new MockKV(),env={COCKPIT_KV:kv,WRITE_TOKEN:'secret'};
  const options={method:'POST',body:JSON.stringify({action:'config',mode:'off'})};
  assert.equal((await worker.fetch(new Request('https://example.com/api/universe',options),env)).status,403);
  assert.equal(kv.writes,0);
  const response=await worker.fetch(new Request('https://example.com/api/universe',{...options,headers:{'X-Vantage-Key':'secret'}}),env);
  assert.equal(response.status,200);assert.equal(JSON.parse(await kv.get(KEYS.universeConfig)).mode,'off');
});

test('events sync cannot mutate via GET and requires a token for POST',async()=>{
  const kv=new MockKV(),env={COCKPIT_KV:kv,WRITE_TOKEN:'secret'};
  assert.equal((await worker.fetch(new Request('https://example.com/api/events-sync'),env)).status,405);
  assert.equal((await worker.fetch(new Request('https://example.com/api/events-sync',{method:'POST',body:'{}'}),env)).status,403);
  assert.equal(kv.writes,0);
});

test('public health and CORS preflight remain available without a key',async()=>{
  const env={COCKPIT_KV:new MockKV(),WRITE_TOKEN:'secret'};
  assert.equal((await worker.fetch(new Request('https://example.com/api/health'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://example.com/api/watchlist',{method:'OPTIONS'}),env)).status,204);
});

test('numeric helpers preserve missing data and valid zeroes',()=>{
  for(const value of [null,undefined,'','  ',false,true,[],{},NaN,Infinity])assert.equal(finite(value),false);
  for(const value of [0,-1,1.25,'0',' 1.25 '])assert.equal(finite(value),true);
  assert.equal(round(null),null);assert.equal(round(0),0);assert.equal(pct(null,100),null);
  assert.equal(mean([null,10,20]),15);assert.equal(median([null,10,20]),15);
  assert.deepEqual(smaSeries([1,null,3,4,5],3),[null,null,null,null,4]);
});

test('short histories do not fabricate a 200-day moving average or long-term regime',()=>{
  const result=analyzeSeriesLatest(syntheticRows(80),{symbol:'NEW',market:'jp',benchmarkMap:new Map()});
  assert.equal(result.sma200,null);assert.equal(result.regime.code,'?');
  const missing=analyzeSeriesLatest(syntheticRows(5),{symbol:'NEW',market:'jp',benchmarkMap:new Map()});
  assert.equal(missing.rsi14,null);assert.equal(missing.ret5,null);assert.equal(missing.atr14,null);
});

test('RSI14 waits for fourteen actual changes and uses the Wilder seed',()=>{
  const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
  const result=rsiWilder(closes);
  assert.ok(result.slice(0,14).every(x=>x===null));
  assert.ok(Math.abs(result[14]-70.4641350211)<1e-8);
  assert.ok(Math.abs(result[15]-66.2496185536)<1e-8);
  assert.deepEqual(rsiWilder([100,101,100]),[null,null,null]);
  assert.equal(rsiWilder(Array(20).fill(100)).at(-1),50);
});

test('missing OHLCV remains visible to quality validation instead of becoming a valid candle',()=>{
  const input=yahooResult(syntheticRows(40));const q=input.indicators.quote[0];
  for(const key of ['open','high','low','volume'])q[key][39]=null;
  const result=normalizeYahooDaily(input),row=result.rows.at(-1);
  assert.equal(row.date,'2026-07-16');assert.equal(row.open,null);assert.equal(row.volume,null);
  const analysis=analyzeSeriesLatest(result.rows,{symbol:'TEST',market:'jp',benchmarkMap:new Map(),expectedDate:row.date});
  assert.equal(analysis.data_quality.data_valid,false);assert.equal(analysis.entry_lane,'D');
  assert.equal(analysis.atr14,null);assert.equal(analysis.close_pos,null);
});

test('unavailable quotes never produce a total-loss PnL',async()=>{
  const position={symbol:'TEST',market:'us',avg_price:100,qty:10};
  const kv=new MockKV({[KEYS.discipline]:JSON.stringify({positions:[position]})});
  let result=(await getPositions({COCKPIT_KV:kv})).positions[0];
  assert.equal(result.current_price,null);assert.equal(result.pnl_pct,null);assert.equal(result.pnl,null);
  await kv.put(KEYS.stage('us'),JSON.stringify({stocks:{TEST:{price:110}}}));
  result=(await getPositions({COCKPIT_KV:kv})).positions[0];
  assert.equal(result.pnl_pct,10);assert.equal(result.pnl,100);
});

test('backtests exclude missing execution prices instead of exiting at zero',()=>{
  const rows=[{date:'2026-01-01',open:95,high:100,low:90,close:100},{date:'2026-01-02',open:101,high:105,low:96,close:103},{date:'2026-01-03',open:null,high:106,low:97,close:104}];
  assert.equal(simulateBacktestTrade({rows,sma5:[]},0,2).status,'invalid_data');
  assert.equal(simulateBacktestTrade({rows:[rows[0],{...rows[1],high:null}],sma5:[]},0,2).status,'invalid_data');
  const report=backtestSeries(syntheticRows(300),syntheticRows(300),{symbol:'TEST',market:'jp'});
  for(const strategy of Object.values(report.strategies))if(strategy.metrics.trades===0){assert.equal(strategy.metrics.expectancy,null);assert.equal(strategy.metrics.win_rate,null);}
});

const html=fs.readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
test('Treasury display and notification consistently use percentage points',async()=>{
  const code=html.slice(html.indexOf('function todayMacroPriceText('),html.indexOf('function todayMacroHtml('));
  const context=vm.createContext({quoteFinite:finite});vm.runInContext(code,context);
  assert.equal(context.todayMacroPriceText('米10年債',{price:4.784}),'4.78%');
  assert.equal(context.todayMacroPriceText('米10年債',{price:null}),'—');
  const env={COCKPIT_KV:new MockKV({'stage:us':JSON.stringify({macro:{'米10年債':{price:4.784}}})})};
  const triggers=await evaluateIndexTriggers(env);
  assert.match(triggers.find(x=>x.key==='tnx_high').body,/4\.78%/);
  assert.equal(triggers.some(x=>x.key==='tnx_low'),false);
});

test('frontend sends saved credentials for private reads and manual refreshes without retrying 403',async()=>{
  let calls=[];const start=html.indexOf('function writeHeaders('),end=html.indexOf('function toast(',start);
  const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,API_BASE:'https://example.com',localStorage:{getItem:()=> 'saved-key'},fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({ok:true})}}});
  vm.runInContext(html.slice(start,end),context);
  await context.api('/api/universe');await context.api('/api/ranking?refresh=1');
  for(const call of calls)assert.equal(call.options.headers['X-Vantage-Key'],'saved-key');
  calls=[];context.fetch=async()=>{calls.push(1);return{ok:false,status:403,json:async()=>({error:'access denied'})}};
  await assert.rejects(context.api('/api/watchlist'),/access denied/);assert.equal(calls.length,1);
});

import { BACKTEST_VERSION, ENGINE_VERSION, LIMITS } from '../config.js';
import { getStockList } from '../storage/stocklist.js';
import { fetchYahooChart } from '../data/yahoo.js';
import { normalizeYahooDaily } from '../data/normalization.js';
import { prepareSeries, analyzePreparedAt } from '../engine/analysis.js';
import { benchmarkValues, sanitizeBenchmarkRows } from '../engine/relative-strength.js';
import { finite, mean, median, round, nowIso, parseJson, stableHash } from '../utils.js';

const STATE=`backtest:${BACKTEST_VERSION}:state`;
const SUMMARY=`backtest:${BACKTEST_VERSION}:summary`;
const PARTIAL=`backtest:${BACKTEST_VERSION}:partial`;
const LOCK=`backtest:${BACKTEST_VERSION}:lock`;
const RULES=`backtest:${BACKTEST_VERSION}:frozen-rules`;
const SYMBOL=(m,s)=>`backtest:${BACKTEST_VERSION}:symbol:${m}:${s}`;
const BENCH=(m,k='primary')=>`backtest:${BACKTEST_VERSION}:benchmark:${m}:${k}`;
const COST=.15;
const GAP=3;
const REFRESH_DAYS=7;
const MAX_RETRIES=5;
const MIN_SUCCESS_RATE=90;
const MIN_HISTORY_DAYS=260;
const STRATEGIES={A:{label:'A初回',max_hold:10},B:{label:'B初回',max_hold:5},C_A:{label:'C→A',max_hold:10},C_B:{label:'C→B',max_hold:5}};

function daysSince(iso){const t=new Date(iso||0).getTime();return Number.isFinite(t)?(Date.now()-t)/86400000:Infinity;}
function itemId(item){return`${item.market}:${String(item.symbol||'').toUpperCase()}`;}
function uniqueById(items=[]){const seen=new Set();return items.filter(x=>{const id=itemId(x);if(!id||seen.has(id))return false;seen.add(id);return true;});}

async function queue(env){
  const [jp,us]=await Promise.all([getStockList(env,'jp'),getStockList(env,'us')]);
  const q=uniqueById([...jp.slice(0,LIMITS.jpMax).map(x=>({...x,market:'jp'})),...us.slice(0,LIMITS.usLead).map(x=>({...x,market:'us'}))]);
  return{queue:q,signature:stableHash(q.map(itemId).sort().join('|'))};
}

function fresh(q,sig){
  return{
    version:BACKTEST_VERSION,status:'running',signature:sig,queue:q,cursor:0,retry_queue:[],attempts:{},
    started_at:nowIso(),updated_at:nowIso(),finished_at:null,errors:[],failures:[],
    pools:Object.fromEntries(Object.keys(STRATEGIES).map(k=>[k,[]])),symbol_summaries:[]
  };
}

function normalizeState(old,snap){
  return{
    ...fresh(snap.queue,snap.signature),...old,version:BACKTEST_VERSION,signature:snap.signature,queue:snap.queue,
    retry_queue:Array.isArray(old?.retry_queue)?old.retry_queue:[],attempts:old?.attempts&&typeof old.attempts==='object'?old.attempts:{},
    errors:Array.isArray(old?.errors)?old.errors:[],failures:Array.isArray(old?.failures)?old.failures:[],
    pools:old?.pools&&typeof old.pools==='object'?old.pools:Object.fromEntries(Object.keys(STRATEGIES).map(k=>[k,[]])),
    symbol_summaries:Array.isArray(old?.symbol_summaries)?old.symbol_summaries:[]
  };
}

async function clearCycle(env){await Promise.all([STATE,SUMMARY,PARTIAL,LOCK,RULES].map(k=>env.COCKPIT_KV.delete(k)));}

async function loadState(env,force=false){
  if(force)await clearCycle(env);
  const snap=await queue(env),old=parseJson(await env.COCKPIT_KV.get(STATE),null),summary=parseJson(await env.COCKPIT_KV.get(SUMMARY),null);
  const stale=old?.status==='complete'&&daysSince(old.finished_at)>=REFRESH_DAYS;
  if(!old||old.version!==BACKTEST_VERSION||old.signature!==snap.signature||stale){const s=fresh(snap.queue,snap.signature);await env.COCKPIT_KV.put(STATE,JSON.stringify(s));return s;}
  const state=normalizeState(old,snap);
  if(state.status==='complete'&&summary?.version===BACKTEST_VERSION&&state.signature===snap.signature)return state;
  return state;
}

export function benchmarkSymbols(market,kind='primary'){
  const m=market==='us'?'us':'jp',secondary=kind==='secondary';
  if(m==='jp')return secondary?['^TOPX','^N225']:['^N225','^TOPX'];
  return secondary?['^IXIC','^GSPC']:['^GSPC','^IXIC'];
}

async function benchmarkOne(env,market,kind){
  const key=BENCH(market,kind),cached=parseJson(await env.COCKPIT_KV.get(key),null);
  const cachedRows=sanitizeBenchmarkRows(cached?.rows);
  if(cached&&daysSince(cached.fetched_at)<7&&cachedRows.length>=MIN_HISTORY_DAYS)return cachedRows;

  let last=null;
  for(const symbol of benchmarkSymbols(market,kind)){
    try{
      const rows=sanitizeBenchmarkRows(normalizeYahooDaily(await fetchYahooChart(symbol,{range:'5y',cacheTtl:600})).rows);
      if(rows.length<MIN_HISTORY_DAYS){last=new Error(`指数履歴不足 ${symbol}: ${rows.length}営業日`);continue;}
      await env.COCKPIT_KV.put(key,JSON.stringify({fetched_at:nowIso(),symbol,rows}));
      return rows;
    }catch(error){
      last=error;
    }
  }

  if(cachedRows.length>=MIN_HISTORY_DAYS)return cachedRows;
  throw last||new Error(`${market} ${kind} benchmark unavailable`);
}

async function benchmark(env,market){
  const primary=await benchmarkOne(env,market,'primary');
  let secondary=primary;
  try{
    secondary=await benchmarkOne(env,market,'secondary');
  }catch(error){
    console.error('[backtest secondary benchmark fallback]',market,error?.message||error);
  }
  return{primary,secondary};
}

export function simulateBacktestTrade(prepared,index,maxHold){
  const rows=prepared?.rows||[];
  const signal=rows[index],next=rows[index+1];
  if(!signal||!next)return{status:'no_next'};

  const gap=(Number(next.open)/Number(signal.close)-1)*100;
  if(gap>GAP)return{status:'gap_skip',gap_pct:round(gap)};

  const trigger=Number(signal.high),stop=Number(signal.low);
  let entry=null,ambiguous=false;

  if(Number(next.open)>=trigger)entry=Number(next.open);
  else if(Number(next.high)>=trigger){
    if(Number(next.low)<=stop)ambiguous=true;
    else entry=trigger;
  }else return{status:'not_triggered'};

  if(ambiguous)return{status:'ambiguous'};
  if(!(finite(stop)&&finite(entry)&&stop>0&&entry>stop))return{status:'invalid_stop'};

  let maxHigh=entry,minLow=entry,exit=null,exitIndex=null,reason='time',pendingMa=false;
  for(let j=index+1;j<rows.length&&j<=index+maxHold;j++){
    const row=rows[j];
    if(!row)break;

    if(pendingMa){
      exit=Number(row.open);
      exitIndex=j;
      reason='ma5_next_open';
      break;
    }

    maxHigh=Math.max(maxHigh,Number(row.high));
    minLow=Math.min(minLow,Number(row.low));

    if(Number(row.open)<=stop){
      exit=Number(row.open);
      exitIndex=j;
      reason='gap_stop';
      break;
    }
    if(Number(row.low)<=stop){
      exit=stop;
      exitIndex=j;
      reason='stop';
      break;
    }

    const atTimeLimit=j===index+maxHold||j===rows.length-1;
    if(atTimeLimit){
      exit=Number(row.close);
      exitIndex=j;
      reason='time';
      break;
    }

    const ma5=prepared?.sma5?.[j];
    if(j>index+1&&finite(ma5)&&Number(row.close)<Number(ma5)){
      pendingMa=true;
    }
  }

  if(!finite(exit)||!Number.isInteger(exitIndex)||!rows[exitIndex]){
    return{status:'open'};
  }

  const ret=(Number(exit)/Number(entry)-1)*100-COST;
  return{
    status:'trade',
    entry_date:next.date,
    exit_date:rows[exitIndex].date,
    entry:round(entry,4),
    exit:round(exit,4),
    stop:round(stop,4),
    return_pct:round(ret),
    mfe_pct:round((maxHigh/entry-1)*100),
    mae_pct:round((minLow/entry-1)*100),
    hold_days:exitIndex-(index+1)+1,
    exit_reason:reason,
    gap_pct:round(gap)
  };
}

function metric(trades){
  const all=trades||[],t=all.filter(x=>x.status==='trade'),r=t.map(x=>x.return_pct),wins=r.filter(x=>x>0),loss=r.filter(x=>x<=0),pos=wins.reduce((a,b)=>a+b,0),neg=Math.abs(loss.reduce((a,b)=>a+b,0));
  let eq=100,peak=100,dd=0;for(const x of t.slice().sort((a,b)=>String(a.exit_date).localeCompare(String(b.exit_date)))){eq*=1+x.return_pct/100;peak=Math.max(peak,eq);dd=Math.min(dd,(eq/peak-1)*100);}
  return{signals:all.length,trades:t.length,not_triggered:all.filter(x=>x.status==='not_triggered').length,gap_skips:all.filter(x=>x.status==='gap_skip').length,ambiguous:all.filter(x=>x.status==='ambiguous').length,trigger_rate:all.length?round(t.length/all.length*100,1):null,win_rate:t.length?round(wins.length/t.length*100,1):null,median_return:round(median(r)),expectancy:round(mean(r)),avg_win:round(mean(wins)),avg_loss:round(mean(loss)),profit_factor:neg>0?round(pos/neg):pos>0?99:null,mfe_median:round(median(t.map(x=>x.mfe_pct))),mae_median:round(median(t.map(x=>x.mae_pct))),avg_hold:round(mean(t.map(x=>x.hold_days)),1),trade_sequence_drawdown:round(dd)};
}
function regimeFromBench(b){if(finite(b?.ret5)&&finite(b?.ret20)&&b.ret5>=1&&b.ret20>=0)return'up';if((finite(b?.ret5)&&b.ret5<=-1.5)||(finite(b?.ret20)&&b.ret20<=-3))return'weak';return'neutral';}

export function backtestSeries(rows,benchRows,meta){
  const primary=Array.isArray(benchRows)?benchRows:(benchRows?.primary||[]),secondary=Array.isArray(benchRows)?[]:(benchRows?.secondary||[]),p=prepareSeries(rows),bm=benchmarkValues(primary),secondaryBm=benchmarkValues(secondary),pools=Object.fromEntries(Object.keys(STRATEGIES).map(k=>[k,[]]));let prev=null;
  for(let i=200;i<p.rows.length-1;i++){
    const a=analyzePreparedAt(p,i,{symbol:meta.symbol,name:meta.name,market:meta.market,benchmarkMap:bm,secondaryBenchmarkMap:secondaryBm,expectedDate:p.rows[i].date,closeConfirmed:true,requireCloseConfirmed:true,snapshotId:`BT-${p.rows[i].date}`,source:'Yahoo Finance'});if(!a)continue;
    const signals=[];if(a.entry_lane==='A'&&prev!=='A')signals.push('A');if(a.entry_lane==='B'&&prev!=='B')signals.push('B');if(prev==='C'&&a.entry_lane==='A')signals.push('C_A');if(prev==='C'&&a.entry_lane==='B')signals.push('C_B');
    const b=bm.get(a.date)||{};for(const key of signals){const sim=simulateBacktestTrade(p,i,STRATEGIES[key].max_hold);pools[key].push({symbol:meta.symbol,name:meta.name,market:meta.market,strategy:key,signal_date:a.date,features:{market_regime:regimeFromBench(b),vol_ratio:a.vol_ratio,rs5:a.rs5,div25:a.div25,close_pos:a.close_pos,setup:a.setup_code},...sim});}prev=a.entry_lane;
  }
  const strategies={};for(const [k,trades] of Object.entries(pools)){const recent=trades.filter(x=>x.signal_date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10));strategies[k]={...STRATEGIES[k],metrics:metric(trades),recent_metrics:metric(recent),trades};}
  return{version:BACKTEST_VERSION,engine_version:ENGINE_VERSION,symbol:meta.symbol,name:meta.name,market:meta.market,history_start:p.rows[0]?.date||null,history_end:p.rows.at(-1)?.date||null,history_days:p.rows.length,strategies,generated_at:nowIso()};
}

const PREDICATES={regime_up:{label:'市場上向き',fn:f=>f.market_regime==='up'},regime_not_weak:{label:'市場弱気を除外',fn:f=>f.market_regime!=='weak'},vol_1_0:{label:'出来高1.0倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1},vol_1_2:{label:'出来高1.2倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1.2},vol_1_5:{label:'出来高1.5倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1.5},rs5_0:{label:'5日RS 0%以上',fn:f=>finite(f.rs5)&&f.rs5>=0},rs5_2:{label:'5日RS +2%以上',fn:f=>finite(f.rs5)&&f.rs5>=2},rs5_5:{label:'5日RS +5%以上',fn:f=>finite(f.rs5)&&f.rs5>=5},div25_m3_3:{label:'25MA乖離 -3〜+3%',fn:f=>finite(f.div25)&&f.div25>=-3&&f.div25<=3},div25_0_5:{label:'25MA乖離 0〜+5%',fn:f=>finite(f.div25)&&f.div25>=0&&f.div25<=5},close_0_6:{label:'終値位置60%以上',fn:f=>finite(f.close_pos)&&f.close_pos>=.6},close_0_75:{label:'終値位置75%以上',fn:f=>finite(f.close_pos)&&f.close_pos>=.75},setup_thrust:{label:'強い反転セットアップ',fn:f=>['reversal_thrust','ipo_momentum'].includes(f.setup)}};
const RULE_SETS=[[],['regime_up'],['regime_not_weak'],['vol_1_0'],['vol_1_2'],['vol_1_5'],['rs5_0'],['rs5_2'],['rs5_5'],['div25_m3_3'],['div25_0_5'],['close_0_6'],['close_0_75'],['setup_thrust'],['regime_up','vol_1_2'],['regime_up','rs5_2'],['regime_up','close_0_75'],['vol_1_2','rs5_2'],['vol_1_2','close_0_75'],['rs5_2','close_0_75'],['div25_m3_3','vol_1_2'],['regime_not_weak','setup_thrust']];
function wilson(wins,n){if(!n)return[null,null];const z=1.96,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return[round((c-h)*100,1),round((c+h)*100,1)];}
function scopedMetric(trades,preds){return metric(trades.filter(x=>preds.every(id=>PREDICATES[id].fn(x.features||{}))));}
function ruleSearch(pools){
  const confirmed=[],research=[],cs=RULE_SETS;
  for(const market of ['jp','us'])for(const strategy of ['A','B','C_A','C_B']){
    const trades=(pools[strategy]||[]).filter(x=>x.market===market).sort((a,b)=>String(a.signal_date).localeCompare(String(b.signal_date))),n=trades.length;if(n<30)continue;
    const a=Math.floor(n*.6),b=Math.floor(n*.8),train=trades.slice(0,a),validation=trades.slice(a,b),test=trades.slice(b),holdout=trades.slice(a);
    const candidates=[];for(const pred of cs){const tr=scopedMetric(train,pred),v=scopedMetric(validation,pred),t=scopedMetric(test,pred),h=scopedMetric(holdout,pred);if(tr.trades<10||v.trades<5||t.trades<5)continue;const [lo,hi]=wilson(Math.round((t.win_rate||0)/100*t.trades),t.trades);candidates.push({market,strategy,predicates:pred,labels:pred.map(x=>PREDICATES[x].label),train:tr,validation:v,test:{...t,win_rate_ci_low:lo,win_rate_ci_high:hi},holdout:h});}
    candidates.sort((x,y)=>(y.validation.win_rate||0)-(x.validation.win_rate||0)||(y.validation.expectancy||-99)-(x.validation.expectancy||-99));
    for(const r of candidates.slice(0,5)){const pass=r.train.trades>=40&&r.validation.trades>=20&&r.test.trades>=20&&r.holdout.trades>=40&&(r.validation.win_rate||0)>=60&&(r.test.win_rate||0)>=60&&(r.holdout.win_rate||0)>=60&&(r.test.expectancy||0)>=.5&&(r.test.profit_factor||0)>=1.4&&(r.test.median_return||-99)>0&&(r.test.win_rate_ci_low||0)>=50;if(pass&&!confirmed.some(x=>x.market===market&&x.strategy===strategy))confirmed.push(r);else research.push(r);}
  }
  return{confirmed,research:research.slice(0,20),criteria:{validation_win_rate:60,test_win_rate:60,test_expectancy:.5,test_profit_factor:1.4,test_median_positive:true}};
}

export function classifyBacktestError(error){
  const text=String(error?.message||error||'').toLowerCase();
  if(/429|rate.?limit|too many requests/.test(text))return'rate_limit';
  if(/401|403|unauthorized|forbidden|crumb/.test(text))return'provider_access';
  if(/404|not found|result missing|no data/.test(text))return'not_found';
  if(/timeout|timed out|network|fetch failed|socket|econn|http 5\d\d/.test(text))return'network';
  if(/provider symbol mismatch|銘柄コード不一致/.test(text))return'symbol_mismatch';
  if(/履歴不足|insufficient history/.test(text))return'history_short';
  if(/cpu|memory|subrequest|limit exceeded/.test(text))return'worker_limit';
  if(/cannot read properties|cannot set properties|referenceerror|typeerror/.test(text))return'analysis_bug';
  return'analysis';
}
function retryableCategory(category){return['rate_limit','provider_access','network','worker_limit'].includes(category);}
export function shouldAutoRestartBacktest(state={}){
  const failures=Array.isArray(state.failures)?state.failures:[];
  return state.status==='failed'&&failures.length>0&&failures.every(x=>retryableCategory(x.category));
}

function errorRecord(item,error,attempt,final=false){
  return{
    id:itemId(item),symbol:item.symbol,name:item.name||item.symbol,market:item.market,attempt,
    category:classifyBacktestError(error),
    error:String(error?.message||error||'unknown error').slice(0,240),
    error_name:String(error?.name||'Error').slice(0,80),
    stack:String(error?.stack||'').slice(0,900),
    final,at:nowIso()
  };
}
function errorCategories(items=[]){const out={};for(const x of items)out[x.category||'analysis']=(out[x.category||'analysis']||0)+1;return out;}
function successCount(s){return new Set((s.symbol_summaries||[]).map(x=>itemId(x))).size;}
function failureCount(s){return new Set((s.failures||[]).map(x=>x.id)).size;}

export function backtestIntegrityFromCounts(total,success,failed,retrying=0,pending=0){
  const rate=total?round(success/total*100,1):0;
  const resolved=success+failed;
  const valid=total>0&&retrying===0&&pending===0&&rate>=MIN_SUCCESS_RATE&&success>=Math.min(total,30);
  let reason='集計中';
  if(retrying||pending)reason=`未処理 ${pending}件・再試行 ${retrying}件`;
  else if(!valid)reason=`成功率 ${rate}%（必要 ${MIN_SUCCESS_RATE}%以上）`;
  else reason=`成功率 ${rate}%・検証利用可`;
  return{total,success,failed,retrying,pending,resolved,success_rate:rate,required_success_rate:MIN_SUCCESS_RATE,valid,reason};
}
function integrityFromState(s){const total=s.queue.length,success=successCount(s),failed=failureCount(s),retrying=(s.retry_queue||[]).length,pending=Math.max(0,total-Number(s.cursor||0));return backtestIntegrityFromCounts(total,success,failed,retrying,pending);}

function summaryFromState(s,includeSelective=s.status==='complete'){
  const strategies={};
  for(const [k,d] of Object.entries(STRATEGIES)){
    const t=s.pools[k]||[],recent=t.filter(x=>x.signal_date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10));
    const market_metrics={},market_recent_metrics={};for(const market of ['jp','us']){market_metrics[market]=metric(t.filter(x=>x.market===market));market_recent_metrics[market]=metric(recent.filter(x=>x.market===market));}
    strategies[k]={...d,metrics:metric(t),recent_metrics:metric(recent),market_metrics,market_recent_metrics};
  }
  const symbols=[];for(const x of s.symbol_summaries||[])for(const [k,v] of Object.entries(x.strategies||{}))if(v.metrics?.trades)symbols.push({symbol:x.symbol,name:x.name,market:x.market,strategy:k,...v.metrics});
  const integrity=integrityFromState(s),usable=s.status==='complete'&&integrity.valid;
  return{
    version:BACKTEST_VERSION,engine_version:ENGINE_VERSION,generated_at:nowIso(),status:s.status,result_usable:usable,system_failure:s.system_failure||null,
    cycle_started_at:s.started_at,cycle_finished_at:s.finished_at,
    progress:{done:integrity.resolved,total:integrity.total,success:integrity.success,failed:integrity.failed,retrying:integrity.retrying,pending:integrity.pending,attempted:Number(s.cursor||0),errors:integrity.failed,error_events:(s.errors||[]).length},
    integrity,error_categories:errorCategories(s.failures||[]),attempt_error_categories:errorCategories(s.errors||[]),
    failures:(s.failures||[]).slice(-50),recent_errors:(s.errors||[]).slice(-12),
    assumptions:{lookback:'5年（取得可能範囲）',entry:'翌営業日にシグナル日高値を突破',gap_skip_pct:GAP,stop:'シグナル日安値',exit:'5日線終値割れ確認後の翌営業日始値、または時間切れ',same_day_ambiguous:'高値突破とストップ接触の順序不明日は除外',round_trip_cost_pct:COST,universe:'現在登録銘柄（日本最大160、米国リード40）',price_series:'ライブと共通のYahoo quote OHLC正規化',rsi_atr:'Wilder RMA',survivorship_bias:true,max_retries:MAX_RETRIES,min_success_rate:MIN_SUCCESS_RATE},
    strategies,symbols,selective:includeSelective&&integrity.valid?ruleSearch(s.pools):{confirmed:[],research:[],pending:true,blocked_reason:integrity.reason}
  };
}

async function freezeSelectiveRules(env,state,summary){
  const old=parseJson(await env.COCKPIT_KV.get(RULES),null);
  if(old?.version===BACKTEST_VERSION&&old.signature===state.signature)return{...summary,selective:old.selective,selective_frozen_at:old.frozen_at,selective_policy:'同一登録母集団では初回完了時のルールを固定。週次再集計で再最適化しない'};
  const frozen={version:BACKTEST_VERSION,signature:state.signature,frozen_at:nowIso(),selective:summary.selective};
  await env.COCKPIT_KV.put(RULES,JSON.stringify(frozen));
  return{...summary,selective:frozen.selective,selective_frozen_at:frozen.frozen_at,selective_policy:'同一登録母集団では初回完了時のルールを固定。週次再集計で再最適化しない'};
}

function nextWork(s){
  if(s.cursor<s.queue.length){const item=s.queue[s.cursor];s.cursor++;return item;}
  return(s.retry_queue||[]).shift()||null;
}
function enqueueRetry(s,item){const id=itemId(item);if(!(s.retry_queue||[]).some(x=>itemId(x)===id))s.retry_queue.push(item);}
function removeFailure(s,id){s.failures=(s.failures||[]).filter(x=>x.id!==id);}
function setFailure(s,record){s.failures=[...(s.failures||[]).filter(x=>x.id!==record.id),record];}
function upsertSummary(s,item,result){const id=itemId(item),entry={symbol:item.symbol,name:item.name,market:item.market,strategies:Object.fromEntries(Object.entries(result.strategies).map(([k,v])=>[k,{metrics:v.metrics}]))};s.symbol_summaries=[...(s.symbol_summaries||[]).filter(x=>itemId(x)!==id),entry];}

async function fetchBacktestRows(symbol){
  let last=null;
  for(const range of ['5y','10y']){
    try{
      const rows=normalizeYahooDaily(await fetchYahooChart(symbol,{range,cacheTtl:600})).rows;
      if(rows.length>=MIN_HISTORY_DAYS)return rows;
      last=new Error(`履歴不足 ${symbol}: ${rows.length}営業日`);
    }catch(error){
      last=error;
    }
  }
  throw last||new Error(`${symbol} history unavailable`);
}

async function analyzeBacktestItem(env,item,benchCache){
  const rows=await fetchBacktestRows(item.symbol);
  if(!benchCache[item.market])benchCache[item.market]=await benchmark(env,item.market);
  const result=backtestSeries(rows,benchCache[item.market],item);
  await env.COCKPIT_KV.put(SYMBOL(item.market,item.symbol),JSON.stringify(result));
  return result;
}

async function finalizeCycle(env,s){
  const integrity=integrityFromState(s);s.finished_at=nowIso();s.status=integrity.valid?'complete':'failed';
  let summary=summaryFromState(s,integrity.valid);if(integrity.valid)summary=await freezeSelectiveRules(env,s,summary);
  await Promise.all([env.COCKPIT_KV.put(STATE,JSON.stringify(s)),env.COCKPIT_KV.put(SUMMARY,JSON.stringify(summary)),env.COCKPIT_KV.delete(PARTIAL)]);
  return summary;
}

export async function runBacktestStep(env,count=1,force=false){
  let s=await loadState(env,force);
  if(s.status==='failed'&&!force&&shouldAutoRestartBacktest(s))s=await loadState(env,true);
  if(['complete','failed'].includes(s.status)&&!force)return{ok:true,skipped:true,reason:s.status==='complete'?'fresh complete result':'failed result requires force restart',...summaryFromState(s,s.status==='complete')};
  const lock=await env.COCKPIT_KV.get(LOCK);if(lock&&Date.now()-Number(lock)<120000)return{ok:true,skipped:true,reason:'locked'};
  await env.COCKPIT_KV.put(LOCK,String(Date.now()),{expirationTtl:180});
  let processed=0;const benchCache={};
  try{
    for(let z=0;z<Math.max(1,Math.min(5,Number(count)||1));z++){
      const item=nextWork(s);if(!item)break;processed++;
      const id=itemId(item),attempt=Number(s.attempts[id]||0)+1;s.attempts[id]=attempt;
      try{
        const result=await analyzeBacktestItem(env,item,benchCache);
        for(const k of Object.keys(STRATEGIES))s.pools[k].push(...(result.strategies[k]?.trades||[]));
        upsertSummary(s,item,result);removeFailure(s,id);
      }catch(error){
        const record=errorRecord(item,error,attempt,false);s.errors=[...(s.errors||[]),record].slice(-200);
        if(record.category==='analysis_bug'){
          setFailure(s,{...record,final:true});
          s.system_failure={category:record.category,error:record.error,symbol:record.symbol,at:record.at};
        }else if(retryableCategory(record.category)&&attempt<MAX_RETRIES)enqueueRetry(s,item);
        else setFailure(s,{...record,final:true});
      }
      s.updated_at=nowIso();
    }
    if(s.system_failure){const summary=await finalizeCycle(env,s);return{ok:true,processed,...summary};}
    if(s.cursor>=s.queue.length&&!(s.retry_queue||[]).length){const summary=await finalizeCycle(env,s);return{ok:true,processed,...summary};}
    await env.COCKPIT_KV.put(STATE,JSON.stringify(s));
    const current=summaryFromState(s,false);if((current.progress.done+current.progress.retrying)%10===0)await env.COCKPIT_KV.put(PARTIAL,JSON.stringify(current));
    return{ok:true,processed,...current,next_symbol:s.cursor<s.queue.length?s.queue[s.cursor]:(s.retry_queue||[])[0]||null};
  }finally{await env.COCKPIT_KV.delete(LOCK);}
}

export async function getBacktestDashboard(env){
  const s=await loadState(env,false),saved=parseJson(await env.COCKPIT_KV.get(SUMMARY),null),partial=parseJson(await env.COCKPIT_KV.get(PARTIAL),null);
  if(['complete','failed'].includes(s.status)&&saved?.version===BACKTEST_VERSION)return{ok:true,...saved};
  if(saved?.version===BACKTEST_VERSION&&saved.result_usable)return{ok:true,...saved,status:'running',progress:summaryFromState(s,false).progress,integrity:integrityFromState(s),using_previous_complete:true,next_symbol:s.queue[s.cursor]||s.retry_queue?.[0]||null};
  const base=partial?.version===BACKTEST_VERSION?{...partial,...summaryFromState(s,false)}:summaryFromState(s,false);
  return{ok:true,...base,status:'running',next_symbol:s.cursor<s.queue.length?s.queue[s.cursor]:s.retry_queue?.[0]||null};
}
export async function getBacktestSymbol(env,market,symbol){const v=parseJson(await env.COCKPIT_KV.get(SYMBOL(market==='us'?'us':'jp',String(symbol||'').toUpperCase())),null);return v?{ok:true,result:v}:{ok:false,error:'not tested yet'};}

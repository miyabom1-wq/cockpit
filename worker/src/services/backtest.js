import { BACKTEST_VERSION, ENGINE_VERSION, LIMITS } from '../config.js';
import { getStockList } from '../storage/stocklist.js';
import { fetchYahooChart } from '../data/yahoo.js';
import { normalizeYahooDaily } from '../data/normalization.js';
import { prepareSeries, analyzePreparedAt } from '../engine/analysis.js';
import { benchmarkValues } from '../engine/relative-strength.js';
import { finite, mean, median, round, nowIso, parseJson, stableHash } from '../utils.js';

const STATE=`backtest:${BACKTEST_VERSION}:state`,SUMMARY=`backtest:${BACKTEST_VERSION}:summary`,PARTIAL=`backtest:${BACKTEST_VERSION}:partial`,LOCK=`backtest:${BACKTEST_VERSION}:lock`,RULES=`backtest:${BACKTEST_VERSION}:frozen-rules`;
const SYMBOL=(m,s)=>`backtest:${BACKTEST_VERSION}:symbol:${m}:${s}`,BENCH=(m,k='primary')=>`backtest:${BACKTEST_VERSION}:benchmark:${m}:${k}`;
const COST=.15,GAP=3,REFRESH_DAYS=7;
const STRATEGIES={A:{label:'A初回',max_hold:10},B:{label:'B初回',max_hold:5},C_A:{label:'C→A',max_hold:10},C_B:{label:'C→B',max_hold:5}};
function daysSince(iso){const t=new Date(iso||0).getTime();return Number.isFinite(t)?(Date.now()-t)/86400000:Infinity;}
async function queue(env){const [jp,us]=await Promise.all([getStockList(env,'jp'),getStockList(env,'us')]);const q=[...jp.slice(0,LIMITS.jpMax).map(x=>({...x,market:'jp'})),...us.slice(0,LIMITS.usLead).map(x=>({...x,market:'us'}))];return{queue:q,signature:stableHash(q.map(x=>`${x.market}:${x.symbol}`).sort().join('|'))};}
function fresh(q,sig){return{version:BACKTEST_VERSION,status:'running',signature:sig,queue:q,cursor:0,started_at:nowIso(),updated_at:nowIso(),finished_at:null,errors:[],pools:Object.fromEntries(Object.keys(STRATEGIES).map(k=>[k,[]])),symbol_summaries:[]};}
async function loadState(env,force=false){
  const snap=await queue(env),old=parseJson(await env.COCKPIT_KV.get(STATE),null),summary=parseJson(await env.COCKPIT_KV.get(SUMMARY),null);
  const stale=old?.status==='complete'&&daysSince(old.finished_at)>=REFRESH_DAYS;
  if(force||!old||old.version!==BACKTEST_VERSION||old.signature!==snap.signature||stale){const s=fresh(snap.queue,snap.signature);await env.COCKPIT_KV.put(STATE,JSON.stringify(s));return s;}
  if(old.status==='complete'&&summary?.version===BACKTEST_VERSION&&old.signature===snap.signature)return old;
  return old;
}
async function benchmarkOne(env,market,kind){const key=BENCH(market,kind),cached=parseJson(await env.COCKPIT_KV.get(key),null);if(cached&&daysSince(cached.fetched_at)<7)return cached.rows;const symbol=kind==='secondary'?(market==='jp'?'^TOPX':'^IXIC'):(market==='jp'?'^N225':'^GSPC'),rows=normalizeYahooDaily(await fetchYahooChart(symbol,{range:'5y',cacheTtl:3600})).rows;await env.COCKPIT_KV.put(key,JSON.stringify({fetched_at:nowIso(),symbol,rows}));return rows;}
async function benchmark(env,market){const [primary,secondary]=await Promise.all([benchmarkOne(env,market,'primary'),benchmarkOne(env,market,'secondary')]);return{primary,secondary};}
function simulate(prepared,index,maxHold){
  const rows=prepared.rows,signal=rows[index],next=rows[index+1];if(!next)return{status:'no_next'};
  const gap=(next.open/signal.close-1)*100;if(gap>GAP)return{status:'gap_skip',gap_pct:round(gap)};
  const trigger=signal.high,stop=signal.low;let entry=null,ambiguous=false;
  if(next.open>=trigger)entry=next.open;
  else if(next.high>=trigger){if(next.low<=stop)ambiguous=true;else entry=trigger;}
  else return{status:'not_triggered'};
  if(ambiguous)return{status:'ambiguous'};if(!(stop>0&&entry>stop))return{status:'invalid_stop'};
  let maxHigh=entry,minLow=entry,exit=null,exitIndex=null,reason='time',pendingMa=false;
  for(let j=index+1;j<rows.length&&j<=index+maxHold;j++){
    const r=rows[j];
    // 5日線割れ翌日の寄りで決済する場合、寄り後の高値・安値をMFE/MAEへ混ぜない。
    if(pendingMa){exit=r.open;exitIndex=j;reason='ma5_next_open';break;}
    maxHigh=Math.max(maxHigh,r.high);minLow=Math.min(minLow,r.low);
    if(r.open<=stop){exit=r.open;exitIndex=j;reason='gap_stop';break;}
    if(r.low<=stop){exit=stop;exitIndex=j;reason='stop';break;}
    const ma5=prepared.sma5[j];if(j>index+1&&finite(ma5)&&r.close<ma5){if(j+1<rows.length){pendingMa=true;continue;}exit=r.close;exitIndex=j;reason='ma5_last_close';break;}
    if(j===index+maxHold||j===rows.length-1){exit=r.close;exitIndex=j;reason='time';break;}
  }
  if(!finite(exit))return{status:'open'};const ret=(exit/entry-1)*100-COST;
  return{status:'trade',entry_date:next.date,exit_date:rows[exitIndex].date,entry:round(entry,4),exit:round(exit,4),stop:round(stop,4),return_pct:round(ret),mfe_pct:round((maxHigh/entry-1)*100),mae_pct:round((minLow/entry-1)*100),hold_days:exitIndex-(index+1)+1,exit_reason:reason,gap_pct:round(gap)};
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
    const b=bm.get(a.date)||{};for(const key of signals){const sim=simulate(p,i,STRATEGIES[key].max_hold);pools[key].push({symbol:meta.symbol,name:meta.name,market:meta.market,strategy:key,signal_date:a.date,features:{market_regime:regimeFromBench(b),vol_ratio:a.vol_ratio,rs5:a.rs5,div25:a.div25,close_pos:a.close_pos,setup:a.setup_code},...sim});}prev=a.entry_lane;
  }
  const strategies={};for(const [k,trades] of Object.entries(pools)){const recent=trades.filter(x=>x.signal_date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10));strategies[k]={...STRATEGIES[k],metrics:metric(trades),recent_metrics:metric(recent),trades};}
  return{version:BACKTEST_VERSION,engine_version:ENGINE_VERSION,symbol:meta.symbol,name:meta.name,market:meta.market,history_start:p.rows[0]?.date||null,history_end:p.rows.at(-1)?.date||null,history_days:p.rows.length,strategies,generated_at:nowIso()};
}
const PREDICATES={regime_up:{label:'市場上向き',fn:f=>f.market_regime==='up'},regime_not_weak:{label:'市場弱気を除外',fn:f=>f.market_regime!=='weak'},vol_1_0:{label:'出来高1.0倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1},vol_1_2:{label:'出来高1.2倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1.2},vol_1_5:{label:'出来高1.5倍以上',fn:f=>finite(f.vol_ratio)&&f.vol_ratio>=1.5},rs5_0:{label:'5日RS 0%以上',fn:f=>finite(f.rs5)&&f.rs5>=0},rs5_2:{label:'5日RS +2%以上',fn:f=>finite(f.rs5)&&f.rs5>=2},rs5_5:{label:'5日RS +5%以上',fn:f=>finite(f.rs5)&&f.rs5>=5},div25_m3_3:{label:'25MA乖離 -3〜+3%',fn:f=>finite(f.div25)&&f.div25>=-3&&f.div25<=3},div25_0_5:{label:'25MA乖離 0〜+5%',fn:f=>finite(f.div25)&&f.div25>=0&&f.div25<=5},close_0_6:{label:'終値位置60%以上',fn:f=>finite(f.close_pos)&&f.close_pos>=.6},close_0_75:{label:'終値位置75%以上',fn:f=>finite(f.close_pos)&&f.close_pos>=.75},setup_thrust:{label:'強い反転セットアップ',fn:f=>['reversal_thrust','ipo_momentum'].includes(f.setup)}};
const RULE_SETS=[
  [],['regime_up'],['regime_not_weak'],['vol_1_0'],['vol_1_2'],['vol_1_5'],['rs5_0'],['rs5_2'],['rs5_5'],['div25_m3_3'],['div25_0_5'],['close_0_6'],['close_0_75'],['setup_thrust'],
  ['regime_up','vol_1_2'],['regime_up','rs5_2'],['regime_up','close_0_75'],['vol_1_2','rs5_2'],['vol_1_2','close_0_75'],['rs5_2','close_0_75'],['div25_m3_3','vol_1_2'],['regime_not_weak','setup_thrust']
];
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
function summaryFromState(s,includeSelective=s.status==='complete'){
  const strategies={};for(const [k,d] of Object.entries(STRATEGIES)){const t=s.pools[k]||[],recent=t.filter(x=>x.signal_date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10));strategies[k]={...d,metrics:metric(t),recent_metrics:metric(recent)};}
  const symbols=[];for(const x of s.symbol_summaries||[])for(const [k,v] of Object.entries(x.strategies||{}))if(v.metrics?.trades)symbols.push({symbol:x.symbol,name:x.name,market:x.market,strategy:k,...v.metrics});
  return{version:BACKTEST_VERSION,engine_version:ENGINE_VERSION,generated_at:nowIso(),status:s.status,cycle_started_at:s.started_at,cycle_finished_at:s.finished_at,progress:{done:s.cursor,total:s.queue.length,errors:s.errors.length},assumptions:{lookback:'5年（取得可能範囲）',entry:'翌営業日にシグナル日高値を突破',gap_skip_pct:GAP,stop:'シグナル日安値',exit:'5日線終値割れ確認後の翌営業日始値、または時間切れ',same_day_ambiguous:'高値突破とストップ接触の順序不明日は除外',round_trip_cost_pct:COST,universe:'現在登録銘柄（日本最大160、米国リード40）',price_series:'ライブと共通のYahoo quote OHLC正規化',rsi_atr:'Wilder RMA',survivorship_bias:true},strategies,symbols,selective:includeSelective?ruleSearch(s.pools):{confirmed:[],research:[],pending:true}};
}

async function freezeSelectiveRules(env,state,summary){
  const old=parseJson(await env.COCKPIT_KV.get(RULES),null);
  if(old?.version===BACKTEST_VERSION&&old.signature===state.signature){
    return{...summary,selective:old.selective,selective_frozen_at:old.frozen_at,selective_policy:'同一登録母集団では初回完了時のルールを固定。週次再集計で再最適化しない'};
  }
  const frozen={version:BACKTEST_VERSION,signature:state.signature,frozen_at:nowIso(),selective:summary.selective};
  await env.COCKPIT_KV.put(RULES,JSON.stringify(frozen));
  return{...summary,selective:frozen.selective,selective_frozen_at:frozen.frozen_at,selective_policy:'同一登録母集団では初回完了時のルールを固定。週次再集計で再最適化しない'};
}

export async function runBacktestStep(env,count=1,force=false){
  let s=await loadState(env,force);if(s.status==='complete'&&!force)return{ok:true,skipped:true,reason:'fresh complete result',...summaryFromState(s)};
  const lock=await env.COCKPIT_KV.get(LOCK);if(lock&&Date.now()-Number(lock)<120000)return{ok:true,skipped:true,reason:'locked'};await env.COCKPIT_KV.put(LOCK,String(Date.now()),{expirationTtl:180});
  try{
    for(let z=0;z<Math.max(1,Math.min(5,Number(count)||1))&&s.cursor<s.queue.length;z++){
      const item=s.queue[s.cursor];try{const rows=normalizeYahooDaily(await fetchYahooChart(item.symbol,{range:'5y',cacheTtl:3600})).rows,bench=await benchmark(env,item.market),result=backtestSeries(rows,bench,item);await env.COCKPIT_KV.put(SYMBOL(item.market,item.symbol),JSON.stringify(result));for(const k of Object.keys(STRATEGIES))s.pools[k].push(...(result.strategies[k]?.trades||[]));s.symbol_summaries.push({symbol:item.symbol,name:item.name,market:item.market,strategies:Object.fromEntries(Object.entries(result.strategies).map(([k,v])=>[k,{metrics:v.metrics}]))});}catch(e){s.errors.push({symbol:item.symbol,error:e?.message||String(e)});}s.cursor++;s.updated_at=nowIso();
    }
    if(s.cursor>=s.queue.length){s.status='complete';s.finished_at=nowIso();const summary=await freezeSelectiveRules(env,s,summaryFromState(s));await Promise.all([env.COCKPIT_KV.put(STATE,JSON.stringify(s)),env.COCKPIT_KV.put(SUMMARY,JSON.stringify(summary))]);return{ok:true,...summary,errors:s.errors.slice(-10)};}
    await env.COCKPIT_KV.put(STATE,JSON.stringify(s));if(s.cursor%10===0)await env.COCKPIT_KV.put(PARTIAL,JSON.stringify(summaryFromState(s,false)));return{ok:true,status:'running',progress:{done:s.cursor,total:s.queue.length,errors:s.errors.length},next_symbol:s.queue[s.cursor],errors:s.errors.slice(-10)};
  }finally{await env.COCKPIT_KV.delete(LOCK);}
}
export async function getBacktestDashboard(env){const s=await loadState(env,false),complete=parseJson(await env.COCKPIT_KV.get(SUMMARY),null),partial=parseJson(await env.COCKPIT_KV.get(PARTIAL),null);if(s.status==='complete'&&complete?.version===BACKTEST_VERSION)return{ok:true,...complete};if(complete?.version===BACKTEST_VERSION)return{ok:true,...complete,status:'running',progress:{done:s.cursor,total:s.queue.length,errors:s.errors.length},using_previous_complete:true,next_symbol:s.queue[s.cursor]||null};const base=partial?.version===BACKTEST_VERSION?partial:summaryFromState(s,false);return{ok:true,...base,status:'running',progress:{done:s.cursor,total:s.queue.length,errors:s.errors.length},next_symbol:s.queue[s.cursor]||null,errors:s.errors.slice(-10)};}
export async function getBacktestSymbol(env,market,symbol){const v=parseJson(await env.COCKPIT_KV.get(SYMBOL(market==='us'?'us':'jp',String(symbol||'').toUpperCase())),null);return v?{ok:true,result:v}:{ok:false,error:'not tested yet'};}

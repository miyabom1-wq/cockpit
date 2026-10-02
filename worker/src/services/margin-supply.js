import { isTradingDay, previousTradingDate } from '../data/calendar.js';
import { KEYS } from '../storage/kv-schema.js';
import { finite, nowIso, parseJson, round } from '../utils.js';

export const MARGIN_DATA_SCHEMA='jp-margin-v2';
const PUBLIC_DATA_URLS=['https://raw.githubusercontent.com/miyabom1-wq/cockpit/main/public/data/jp-margin.json','https://miyabom1-wq.github.io/cockpit/data/jp-margin.json'];
const CACHE_TTL=6*3600;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function normalizedSymbol(v){const s=String(v||'').toUpperCase().trim();return /\.T$/.test(s)?s:/^[0-9A-Z]{4}$/.test(s)?`${s}.T`:s;}
function validDataset(x){return x&&[MARGIN_DATA_SCHEMA,'jp-margin-v1'].includes(x.schema)&&x.items&&typeof x.items==='object';}
export function marginGeneratedJstDate(data){
  const t=Date.parse(data?.generated_at||'');
  return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,10):null;
}
// JPX publishes the previous trading day's application balances at about 16:00 JST.
export function expectedMarginDate(now=new Date()){
  const jst=new Date(now.getTime()+9*3600000),day=jst.toISOString().slice(0,10);
  let publication=previousTradingDate('jp',new Date(day+'T00:00:00Z'));
  if(isTradingDay('jp',day)&&jst.getUTCHours()<16)publication=previousTradingDate('jp',new Date(Date.parse(day)-86400000));
  return previousTradingDate('jp',new Date(Date.parse(publication)-86400000));
}
export function marginDatasetFreshForTradeDate(data,tradeDate){
  const expected=expectedMarginDate(new Date(String(tradeDate)+'T08:00:00Z'));
  return data?.schema===MARGIN_DATA_SCHEMA&&data?.daily?.as_of===expected;
}
export function marginFreshness(data,now=new Date()){
  const asOf=data?.daily?.as_of||data?.weekly?.as_of||null,expected=expectedMarginDate(now);
  const stale=data?.schema!==MARGIN_DATA_SCHEMA||!asOf||asOf!==expected;
  return {stale,as_of:asOf,expected_as_of:expected,stale_reason:stale?(data?.schema!==MARGIN_DATA_SCHEMA?'旧週次データ':!asOf?'基準日不明':asOf>expected?'基準日異常':'最新公表分の取込待ち'):null};
}

function marginFreshnessError(data,tradeDate){
  const generatedDate=marginGeneratedJstDate(data),error=new Error(`信用需給データ更新待ち: 基準日=${data?.daily?.as_of||data?.weekly?.as_of||'不明'} 対象取引日=${tradeDate||'不明'}`);
  error.code='MARGIN_DATA_NOT_FRESH';error.generated_date=generatedDate;error.expected_date=tradeDate||null;return error;
}

export function evaluateMarginSupply(analysis,item,{now=new Date(),dataset=null}={}){
  const daily=!!item?.daily,weekly=item?.daily||item?.weekly||null,flags=item?.flags||{},reasons=[],cautions=[];
  if(!weekly){
    if(flags.margin_restriction)cautions.push('信用取引規制中');
    if(flags.special_notice)cautions.push('特別周知銘柄');
    if(flags.daily_disclosure)cautions.push('日々公表銘柄（規制とは別）');
    return{available:false,label:cautions.length?'需給注意':'データ待ち',score:flags.margin_restriction?-12:flags.special_notice?-8:flags.daily_disclosure?-2:0,as_of:null,published_at:null,summary:cautions.join(' / ')||'日次信用残の取得待ち',reasons,cautions,flags,add_blocked:!!(flags.margin_restriction||flags.special_notice),position_cap:flags.margin_restriction?'reduced':'normal'};
  }
  const freshness=marginFreshness({...(dataset||{}),schema:daily?(dataset?.schema||MARGIN_DATA_SCHEMA):'jp-margin-v1',daily:daily?weekly:null,weekly},now);
  if(freshness.stale||!daily||weekly.as_of!==freshness.expected_as_of){
    const restricted=!!(flags.margin_restriction||flags.special_notice);
    return {available:true,stale:true,label:'stale（参考値）',score:restricted?-12:0,
      as_of:weekly.as_of||null,published_at:weekly.published_at||null,
      last_fetched_at:dataset?.worker_synced_at||null,expected_as_of:freshness.expected_as_of,
      buy_balance:weekly.buy_balance??null,sell_balance:weekly.sell_balance??null,
      ratio:finite(weekly.buy_balance)&&finite(weekly.sell_balance)&&weekly.sell_balance>0?round(weekly.buy_balance/weekly.sell_balance,2):null,
      buy_day_change_pct:daily?weekly.buy_change_pct??null:null,buy_5d_change_pct:daily?weekly.buy_5d_change_pct??null:null,
      summary:`stale / 基準日 ${weekly.as_of||'不明'} / ${freshness.stale_reason} / 需給評価対象外`,
      reasons:[],cautions:[freshness.stale_reason,...(restricted?['信用規制・特別周知（最終確認値）']:[])],flags,
      add_blocked:restricted,position_cap:restricted?'reduced':'normal'};
  }
  const buy=weekly.buy_balance,sell=weekly.sell_balance,buyChangePct=weekly.buy_5d_change_pct??null,sellChangePct=weekly.sell_5d_change_pct??null;
  const ratio=finite(buy)&&finite(sell)&&sell>0?buy/sell:null,avgVol=Number(analysis?.avg_volume20),turnover=finite(buy)&&finite(avgVol)&&avgVol>0?buy/avgVol:null,ret5=Number(analysis?.ret5);
  let score=0;
  if(finite(ret5)&&finite(buyChangePct)){
    if(ret5>0&&buyChangePct<=-5){score+=12;reasons.push('株価上昇と信用買残減少が同時進行');}
    else if(ret5<0&&buyChangePct>=5){score-=15;cautions.push('株価下落中に信用買残が増加');}
    else if(ret5>0&&buyChangePct>=10){score-=5;cautions.push('上昇を信用買いが追随');}
    else if(ret5<0&&buyChangePct<=-5){score+=5;reasons.push('下落中に信用整理が進行');}
  }
  if(finite(buyChangePct)){
    if(buyChangePct<=-15){score+=8;reasons.push(`信用買残が5営業日前比${round(buyChangePct,1)}%減少`);}
    else if(buyChangePct>=20){score-=10;cautions.push(`信用買残が5営業日前比${round(buyChangePct,1)}%急増`);}
    else if(buyChangePct>=10){score-=6;cautions.push(`信用買残が5営業日前比${round(buyChangePct,1)}%増加`);}
  }
  if(finite(turnover)){
    if(turnover>=5){score-=15;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover>=3){score-=8;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover>=2){score-=4;cautions.push(`買残が平均出来高${round(turnover,1)}日分`);}
    else if(turnover<.8){score+=5;reasons.push('買残は平均出来高1日分未満');}
  }
  if(finite(ratio)){
    if(ratio>=20){score-=8;cautions.push(`信用倍率${round(ratio,1)}倍`);}
    else if(ratio>=10){score-=4;cautions.push(`信用倍率${round(ratio,1)}倍`);}
    else if(ratio<1){score+=5;reasons.push('売残が買残を上回る');}
  }else if(finite(buy)&&buy>0&&sell===0){score-=5;cautions.push('信用売残ゼロ');}
  if(flags.daily_disclosure){score-=2;cautions.push('日々公表銘柄（注意喚起・規制ではない）');}
  if(flags.special_notice){score-=10;cautions.push('特別周知銘柄');}
  if(flags.margin_restriction){score-=12;cautions.push('信用取引規制中');}
  score=clamp(round(score,1),-40,30);
  const label=score>=11?'需給追い風':score>=4?'需給改善':score<=-18?'需給警戒':score<=-7?'需給悪化':'中立';
  const addBlocked=!!(flags.margin_restriction||flags.special_notice);
  const summary=[label,`基準日 ${weekly.as_of||'不明'}`,finite(weekly.buy_change_pct)?`買残前日比 ${round(weekly.buy_change_pct,1)}%`:'買残前日比 比較不能',!finite(buyChangePct)?'5営業日前比 比較不能':null,finite(buyChangePct)?`買残5営業日前比 ${buyChangePct>=0?'+':''}${round(buyChangePct,1)}%`:null,finite(ratio)?`倍率 ${round(ratio,1)}倍`:null,finite(turnover)?`買残回転 ${round(turnover,1)}日`:null].filter(Boolean).join(' / ');
  return{available:true,stale:false,last_fetched_at:dataset?.worker_synced_at||null,buy_day_change_pct:weekly.buy_change_pct??null,buy_5d_change_pct:buyChangePct,previous_as_of:weekly.previous_as_of||null,five_day_as_of:weekly.five_day_as_of||null,label,score,as_of:weekly.as_of||null,published_at:weekly.published_at||null,buy_balance:finite(buy)?buy:null,sell_balance:finite(sell)?sell:null,buy_change:finite(weekly.buy_change)?Number(weekly.buy_change):null,sell_change:finite(weekly.sell_change)?Number(weekly.sell_change):null,buy_change_pct:finite(buyChangePct)?round(buyChangePct,1):null,sell_change_pct:finite(sellChangePct)?round(sellChangePct,1):null,buy_4w_change_pct:finite(weekly.buy_4w_change_pct)?Number(weekly.buy_4w_change_pct):null,ratio:finite(ratio)?round(ratio,2):null,buy_turnover_days:finite(turnover)?round(turnover,2):null,summary,reasons,cautions,flags,add_blocked:addBlocked,position_cap:addBlocked?'reduced':score<=-18?'reduced':'normal',source_url:weekly.source_url||null};
}

async function fetchPublicDataset(env){
  let last=null;const candidates=[];
  for(const base of PUBLIC_DATA_URLS){
    try{
      const res=await fetch(`${base}?v=${Date.now()}`,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','Cache-Control':'no-cache','User-Agent':'VANTAGE/53 margin-supply'},cf:{cacheTtl:0}});
      if(!res.ok){last=new Error(`信用需給データ HTTP ${res.status}`);continue;}
      const data=await res.json();
      if(!validDataset(data)||data.schema!==MARGIN_DATA_SCHEMA){last=new Error('信用需給データ形式が不正です');continue;}
      candidates.push({...data,worker_sync_source:base,worker_synced_at:nowIso()});
    }catch(error){last=error;}
  }
  // A release contains a validated snapshot for initial migration. Freshness still
  // uses its balance date; bundled data never becomes fresh just by redeploying.
  if(env?.ASSETS){
    try{const res=await env.ASSETS.fetch(new Request('https://vantage.local/data/jp-margin.json'));
      const data=await res.json();if(validDataset(data)&&data.schema===MARGIN_DATA_SCHEMA)candidates.push({...data,worker_sync_source:'bundled-jpx-snapshot',worker_synced_at:nowIso()});
    }catch(e){last=e;}
  }
  if(candidates.length)return candidates.sort((a,b)=>String(b.daily?.as_of||'').localeCompare(String(a.daily?.as_of||''))||String(b.generated_at||'').localeCompare(String(a.generated_at||'')))[0];
  throw last||new Error('信用需給データを取得できませんでした');
}
export async function getMarginDataset(env,{force=false,fetchIfMissing=true,requireGeneratedDate=null}={}){
  const cached=parseJson(await env.COCKPIT_KV.get(KEYS.marginSupply),null),cachedValid=validDataset(cached);
  const decorate=data=>({...data,...marginFreshness(data)});
  const recent=cachedValid&&Date.now()-Date.parse(cached.worker_synced_at||'')<CACHE_TTL*1000;
  if(!force&&cachedValid&&(!fetchIfMissing||recent)){
    if(requireGeneratedDate&&!marginDatasetFreshForTradeDate(cached,requireGeneratedDate))throw marginFreshnessError(cached,requireGeneratedDate);
    return decorate(cached);
  }
  if(!force&&!fetchIfMissing)return decorate({schema:MARGIN_DATA_SCHEMA,items:{}});
  try{
    const fetched=await fetchPublicDataset(env);
    if(requireGeneratedDate&&!marginDatasetFreshForTradeDate(fetched,requireGeneratedDate))throw marginFreshnessError(fetched,requireGeneratedDate);
    const newDate=fetched.daily?.as_of||fetched.weekly?.as_of||'',oldDate=cached?.daily?.as_of||cached?.weekly?.as_of||'';
    if(cachedValid&&newDate<oldDate)throw new Error('信用残高の基準日が後退したため更新を保留');
    // History is maintained in the source file; KV needs only computed comparisons.
    const data={...fetched,items:Object.fromEntries(Object.entries(fetched.items).map(([k,{history,...v}])=>[k,v]))};
    if(cached?.generated_at!==data.generated_at||cached?.schema!==data.schema)await env.COCKPIT_KV.put(KEYS.marginSupply,JSON.stringify(data));
    return decorate(data);
  }catch(e){
    if(cachedValid&&!requireGeneratedDate)return{...decorate(cached),cache_warning:e?.message||String(e)};
    throw e;
  }
}

export function enrichMarginSupply(rows,dataset,options={}){
  if(!Array.isArray(rows))return rows;const items=dataset?.items||{};
  for(const row of rows){
    if(row?.market!=='jp')continue;const item=items[normalizedSymbol(row.symbol)]||items[String(row.symbol||'').replace(/\.T$/,'')]||null,supply=evaluateMarginSupply(row,item,{...options,dataset});
    row.entry_reason=(row.entry_reason||[]).filter(x=>!x.startsWith('信用需給:'));row.risk_reason=(row.risk_reason||[]).filter(x=>!x.startsWith('信用需給:'));
    row.margin_supply=supply;row.supply_label=supply.label;row.supply_score=supply.score;row.margin_ratio=supply.ratio??null;row.margin_buy_balance=supply.buy_balance??null;row.margin_sell_balance=supply.sell_balance??null;row.margin_buy_change_pct=supply.buy_change_pct??null;row.margin_turnover_days=supply.buy_turnover_days??null;row.margin_as_of=supply.as_of??null;row.margin_add_blocked=!!supply.add_blocked;
    row.entry_sort_score=round(Number(row.rs_percentile||0)+clamp(Number(supply.score||0),-20,20)*.5,2);
    if(supply.score>=4&&supply.reasons?.length){const v=`信用需給: ${supply.reasons[0]}`;row.entry_reason=[...new Set([...(row.entry_reason||[]),v])];}
    if(supply.score<=-7||supply.add_blocked){const v=`信用需給: ${(supply.cautions||[])[0]||supply.label}`;row.risk_reason=[...new Set([...(row.risk_reason||[]),v])];}
    if(row.audit)row.audit.margin_supply=supply;
  }
  return rows;
}

export async function enrichRowsWithMargin(env,rows,{force=false}={}){
  try{return enrichMarginSupply(rows,await getMarginDataset(env,{force,fetchIfMissing:force}));}catch(e){for(const r of rows||[])if(r?.market==='jp'){r.margin_supply={available:false,label:'データ待ち',score:0,summary:e?.message||String(e),reasons:[],cautions:[],flags:{},add_blocked:false,position_cap:'normal'};r.supply_label='データ待ち';r.supply_score=0;}return rows;}
}

export async function getMarginDashboard(env,{force=false}={}){
  const data=await getMarginDataset(env,{force}),items=Object.values(data.items||{}),flagged=items.filter(x=>x.flags?.daily_disclosure||x.flags?.special_notice||x.flags?.margin_restriction);
  return{ok:true,schema:data.schema,generated_at:data.generated_at,daily:data.daily||null,weekly:data.weekly||null,as_of:data.as_of||null,expected_as_of:data.expected_as_of,last_fetched_at:data.worker_synced_at||null,stale_reason:data.stale_reason||null,rules:data.rules||null,count:items.length,flagged_count:flagged.length,stale:!!data.stale,cache_warning:data.cache_warning||null,source:data.source||{},flagged:flagged.slice(0,100).map(x=>({symbol:x.symbol,name:x.name,daily:x.daily||null,weekly:x.weekly||null,flags:x.flags||{}}))};
}

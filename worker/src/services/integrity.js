import { finite, round } from '../utils.js';

function isoTime(value){
  const t=Date.parse(String(value||''));
  return Number.isFinite(t)?t:0;
}
function macroDate(value){return String(value?.date||'');}
function macroTime(value){return Math.max(isoTime(value?.price_time),isoTime(value?.fetched_at),isoTime(value?.snapshot_updated_at),isoTime(macroDate(value)?`${macroDate(value)}T00:00:00Z`:''));}

export function mergeMacroSnapshots(...snapshots){
  const out={};
  for(const snapshot of snapshots){
    const items=snapshot?.items&&typeof snapshot.items==='object'?snapshot.items:snapshot;
    if(!items||typeof items!=='object')continue;
    for(const [name,raw] of Object.entries(items)){
      if(!raw||typeof raw!=='object')continue;
      const next={...raw},prev=out[name];
      if(!prev){out[name]=next;continue;}
      const nextDate=macroDate(next),prevDate=macroDate(prev);
      if(nextDate>prevDate||(nextDate===prevDate&&macroTime(next)>=macroTime(prev)))out[name]=next;
    }
  }
  return out;
}

function observationFresh(value,referenceDate){
  if(!value?.date||!referenceDate)return true;
  const a=Date.parse(`${value.date}T00:00:00Z`),b=Date.parse(`${referenceDate}T00:00:00Z`);
  if(!Number.isFinite(a)||!Number.isFinite(b))return true;
  return b-a<=4*86400000;
}
function shortDate(value){
  const m=String(value||'').match(/^\d{4}-(\d{2})-(\d{2})$/);return m?`${Number(m[1])}/${Number(m[2])}`:'';
}
function dated(label,value){const d=shortDate(value?.date);return d?`${label} (${d})`:label;}
function dateDistance(a,b){
  const x=Date.parse(`${a||''}T00:00:00Z`),y=Date.parse(`${b||''}T00:00:00Z`);return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/86400000:null;
}
function pushReason(reasons,label,value,threshold,mode='down'){
  if(!finite(value))return 0;
  const v=Number(value),hit=mode==='up'?v>=threshold:v<=threshold;
  if(hit)reasons.push(`${label} ${v>=0?'+':''}${round(v,1)}%`);
  return hit?1:0;
}
function result(level,label,block,score,reasons,referenceDate,meta){
  return{level,label,block_new_entries:block,score,reasons:[...new Set(reasons)].slice(0,7),reference_date:referenceDate,...meta};
}

export function evaluateRiskGate(market,macro={}){
  const primaryName=market==='us'?'S&P500':'日経平均',primary=macro[primaryName]||{},sox=macro.SOX||{},kospi=macro['韓国KOSPI']||{},vix=macro.VIX||{};
  const dates=Object.values(macro).map(x=>x?.date).filter(Boolean).sort(),referenceDate=dates.at(-1)||null;
  const keyDates={primary:primary.date||null,nikkei_futures:macro['日経先物（CME円建て）']?.date||null,kospi:kospi.date||null,sox:sox.date||null,vix:vix.date||null};
  const distinct=[...new Set(Object.values(keyDates).filter(Boolean))],meta={mixed_dates:distinct.length>1,data_dates:keyDates,lagged_confirmation:false};
  let primaryScore=0,soxScore=0,kospiScore=0,vixScore=0;
  const primaryReasons=[],soxReasons=[],kospiReasons=[],vixReasons=[];
  if(observationFresh(primary,referenceDate)){
    primaryScore+=pushReason(primaryReasons,dated(primaryName+' 前日比',primary),primary.change_pct,-4)*4;
    primaryScore+=pushReason(primaryReasons,dated(primaryName+' 5日',primary),primary.ret5,-6)*3;
    primaryScore+=pushReason(primaryReasons,dated(primaryName+' 前日比',primary),primary.change_pct,-2)*1;
    primaryScore+=pushReason(primaryReasons,dated(primaryName+' 5日',primary),primary.ret5,-3)*1;
  }
  if(observationFresh(sox,referenceDate)){
    soxScore+=pushReason(soxReasons,dated('SOX 前日比',sox),sox.change_pct,-4)*3;
    soxScore+=pushReason(soxReasons,dated('SOX 5日',sox),sox.ret5,-7)*3;
    soxScore+=pushReason(soxReasons,dated('SOX 5日',sox),sox.ret5,-4)*1;
  }
  if(observationFresh(kospi,referenceDate)){
    kospiScore+=pushReason(kospiReasons,dated('KOSPI 前日比',kospi),kospi.change_pct,-4)*2;
    kospiScore+=pushReason(kospiReasons,dated('KOSPI 5日',kospi),kospi.ret5,-5)*2;
  }
  if(observationFresh(vix,referenceDate)){
    vixScore+=pushReason(vixReasons,dated('VIX 前日比',vix),vix.change_pct,5,'up')*1;
    vixScore+=pushReason(vixReasons,dated('VIX 5日',vix),vix.ret5,8,'up')*1;
  }
  const severePrimary=Number(primary.change_pct)<=-4||Number(primary.ret5)<=-6,severeSox=Number(sox.change_pct)<=-4||Number(sox.ret5)<=-7;
  const severeKospi=Number(kospi.change_pct)<=-4||Number(kospi.ret5)<=-5,lag=dateDistance(primary.date,kospi.date);
  if(severePrimary&&severeKospi&&lag!=null&&lag>=2&&lag<=4){
    meta.lagged_confirmation=true;
    kospiScore=Math.min(kospiScore,1);
    kospiReasons.length=0;kospiReasons.push(`KOSPI ${shortDate(kospi.date)} 遅行確認（地域急落の重複加点を抑制）`);
  }
  const score=primaryScore+soxScore+kospiScore+vixScore,reasons=[...primaryReasons,...soxReasons,...kospiReasons,...vixReasons];
  if(score>=5||((severePrimary||severeSox)&&score>=4))return result('stress',severePrimary||severeSox?'ストレス／価格発見':'ストレス',true,score,reasons,referenceDate,meta);
  if(score>=2)return result('caution','警戒・選別',false,score,reasons,referenceDate,meta);
  return result('normal','通常',false,score,[],referenceDate,meta);
}

export function providerSymbolMatches(requested,provider){
  const a=String(requested||'').trim().toUpperCase(),b=String(provider||'').trim().toUpperCase();
  if(!a||!b)return false;
  return a===b;
}

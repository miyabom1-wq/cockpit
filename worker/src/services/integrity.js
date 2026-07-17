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
      const next={...raw};
      const prev=out[name];
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
function pushReason(reasons,label,value,threshold,mode='down'){
  if(!finite(value))return 0;
  const v=Number(value),hit=mode==='up'?v>=threshold:v<=threshold;
  if(hit)reasons.push(`${label} ${v>=0?'+':''}${round(v,1)}%`);
  return hit?1:0;
}

export function evaluateRiskGate(market,macro={}){
  const primaryName=market==='us'?'S&P500':'日経平均',primary=macro[primaryName]||{},sox=macro.SOX||{},kospi=macro['韓国KOSPI']||{},vix=macro.VIX||{};
  const dates=Object.values(macro).map(x=>x?.date).filter(Boolean).sort(),referenceDate=dates.at(-1)||null;
  let score=0;const reasons=[];
  if(observationFresh(primary,referenceDate)){
    score+=pushReason(reasons,primaryName+' 前日比',primary.change_pct,-4)*4;
    score+=pushReason(reasons,primaryName+' 5日',primary.ret5,-6)*3;
    score+=pushReason(reasons,primaryName+' 前日比',primary.change_pct,-2)*1;
    score+=pushReason(reasons,primaryName+' 5日',primary.ret5,-3)*1;
  }
  if(observationFresh(sox,referenceDate)){
    score+=pushReason(reasons,'SOX 前日比',sox.change_pct,-4)*3;
    score+=pushReason(reasons,'SOX 5日',sox.ret5,-7)*3;
    score+=pushReason(reasons,'SOX 5日',sox.ret5,-4)*1;
  }
  if(observationFresh(kospi,referenceDate)){
    score+=pushReason(reasons,'KOSPI 前日比',kospi.change_pct,-4)*2;
    score+=pushReason(reasons,'KOSPI 5日',kospi.ret5,-5)*2;
  }
  if(observationFresh(vix,referenceDate)){
    score+=pushReason(reasons,'VIX 前日比',vix.change_pct,5,'up')*1;
    score+=pushReason(reasons,'VIX 5日',vix.ret5,8,'up')*1;
  }
  const severePrimary=Number(primary.change_pct)<=-4||Number(primary.ret5)<=-6;
  const severeSox=Number(sox.change_pct)<=-4||Number(sox.ret5)<=-7;
  if(score>=5||((severePrimary||severeSox)&&score>=4))return{level:'stress',label:severePrimary||severeSox?'ストレス／価格発見':'ストレス',block_new_entries:true,score,reasons:[...new Set(reasons)].slice(0,6),reference_date:referenceDate};
  if(score>=2)return{level:'caution',label:'警戒・選別',block_new_entries:false,score,reasons:[...new Set(reasons)].slice(0,6),reference_date:referenceDate};
  return{level:'normal',label:'通常',block_new_entries:false,score,reasons:[],reference_date:referenceDate};
}

export function providerSymbolMatches(requested,provider){
  const a=String(requested||'').trim().toUpperCase(),b=String(provider||'').trim().toUpperCase();
  if(!a||!b)return false;
  return a===b;
}

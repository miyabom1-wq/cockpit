import { finite, pct, mean, median, round } from '../utils.js';
export const COHORTS={
  extended_acceleration:a=>['strong','extreme'].includes(a.extensionState)&&a.momentumState==='acceleration',
  extended_continuation:a=>['strong','extreme'].includes(a.extensionState)&&a.momentumState==='continuation',
  extreme_climax:a=>a.extensionState==='extreme'&&a.momentumState==='climax',
  ma5_rs_fading:a=>a.momentumEvidence?.signals.below5&&a.momentumEvidence?.signals.rsFading,
  breakout_volume:a=>a.momentumEvidence?.signals.breakout&&finite(a.vol_ratio)&&a.vol_ratio>=1.2,
  reacceleration:a=>a.momentumState==='reacceleration'
};
export function newMomentumStudy(){return Object.fromEntries(Object.keys(COHORTS).map(k=>[k,[]]));}
export function recordMomentumStudy(groups,p,i,a){
  if(!a.data_quality?.data_valid)return;
  for(const [key,match] of Object.entries(COHORTS))if(match(a)){
    const returns={};for(const h of [5,10,20])returns[h]=p.rows[i+h]?round(pct(p.rows[i+h].close,p.rows[i].close)):null;
    groups[key].push({date:a.date,extensionState:a.extensionState,momentumState:a.momentumState,returns});
  }
}
export function summarizeMomentumStudy(groups){
 return {method:'signal-close to future-close; trading sessions; no costs; overlapping observations; descriptive, not a tradable return',horizons:[5,10,20],cohorts:Object.fromEntries(Object.entries(groups).map(([key,samples])=>[key,{count:samples.length,returns:Object.fromEntries([5,10,20].map(h=>{const xs=samples.map(s=>s.returns[h]).filter(finite);return[h,{n:xs.length,pending:samples.length-xs.length,mean:round(mean(xs)),median:round(median(xs)),winRate:xs.length?round(xs.filter(x=>x>0).length/xs.length*100):null}]})),samples}]))};
}

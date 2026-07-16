import { finite } from '../utils.js';
export function smaAt(values, period, index = values.length - 1) {
  if (period<=0 || index<period-1) return null;
  let sum=0;
  for(let i=index-period+1;i<=index;i++){ if(!finite(values[i])) return null; sum+=Number(values[i]); }
  return sum/period;
}
export function smaSeries(values, period) {
  const out=Array(values.length).fill(null); let sum=0,valid=0;
  for(let i=0;i<values.length;i++){
    const v=Number(values[i]); if(finite(v)){sum+=v;valid++;}
    if(i>=period){const old=Number(values[i-period]);if(finite(old)){sum-=old;valid--;}}
    if(i>=period-1&&valid===period)out[i]=sum/period;
  }
  return out;
}
export function emaSeries(values, period) {
  const out=Array(values.length).fill(null),k=2/(period+1);let seed=[];let prev=null;
  for(let i=0;i<values.length;i++){
    if(!finite(values[i]))continue;const v=Number(values[i]);
    if(prev==null){seed.push(v);if(seed.length===period){prev=seed.reduce((a,b)=>a+b,0)/period;out[i]=prev;}}
    else{prev=v*k+prev*(1-k);out[i]=prev;}
  }
  return out;
}

import { finite } from '../utils.js';
export function wilderRma(values, period) {
  const out=Array(values.length).fill(null);let seed=[],prev=null;
  for(let i=0;i<values.length;i++){
    if(!finite(values[i]))continue;const v=Number(values[i]);
    if(prev==null){seed.push(v);if(seed.length===period){prev=seed.reduce((a,b)=>a+b,0)/period;out[i]=prev;}}
    else{prev=(prev*(period-1)+v)/period;out[i]=prev;}
  }
  return out;
}
export function rsiWilder(closes, period=14) {
  const gains=Array(closes.length).fill(null),losses=Array(closes.length).fill(null);
  for(let i=1;i<closes.length;i++){
    if(!finite(closes[i])||!finite(closes[i-1]))continue;
    const d=Number(closes[i])-Number(closes[i-1]);gains[i]=Math.max(d,0);losses[i]=Math.max(-d,0);
  }
  const ag=wilderRma(gains,period),al=wilderRma(losses,period),out=Array(closes.length).fill(null);
  for(let i=0;i<closes.length;i++){
    if(!finite(ag[i])||!finite(al[i]))continue;
    if(Number(al[i])===0)out[i]=100;else{const rs=Number(ag[i])/Number(al[i]);out[i]=100-100/(1+rs);}
  }
  return out;
}
export function atrWilder(rows, period=14) {
  const tr=Array(rows.length).fill(null);
  for(let i=0;i<rows.length;i++){
    const r=rows[i];if(!r)continue;
    if(i===0||!finite(rows[i-1]?.close))tr[i]=Number(r.high)-Number(r.low);
    else tr[i]=Math.max(Number(r.high)-Number(r.low),Math.abs(Number(r.high)-Number(rows[i-1].close)),Math.abs(Number(r.low)-Number(rows[i-1].close)));
  }
  return wilderRma(tr,period);
}

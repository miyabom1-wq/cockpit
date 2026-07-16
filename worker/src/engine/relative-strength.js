import { finite, pct, round } from '../utils.js';
export function returnAt(closes,index,period){return index>=period?pct(closes[index],closes[index-period]):null;}
export function benchmarkValues(benchmarkRows){
  const map=new Map(),closes=benchmarkRows.map(r=>r.close);
  for(let i=0;i<benchmarkRows.length;i++)map.set(benchmarkRows[i].date,{ret5:returnAt(closes,i,5),ret20:returnAt(closes,i,20),change_pct:returnAt(closes,i,1)});
  return map;
}
export function rsAt(prepared,index,benchmarkMap){
  const own5=returnAt(prepared.close,index,5),own20=returnAt(prepared.close,index,20),b=benchmarkMap?.get(prepared.rows[index]?.date)||{};
  return{
    ret5:round(own5),ret20:round(own20),benchmark_ret5:round(b.ret5),benchmark_ret20:round(b.ret20),
    rs5:finite(own5)&&finite(b.ret5)?round(Number(own5)-Number(b.ret5)):null,
    rs20:finite(own20)&&finite(b.ret20)?round(Number(own20)-Number(b.ret20)):null
  };
}
export function percentile(value, values){
  const xs=values.filter(finite).map(Number).sort((a,b)=>a-b);if(!finite(value)||!xs.length)return null;
  const count=xs.filter(x=>x<=Number(value)).length;return round(count/xs.length*100,1);
}

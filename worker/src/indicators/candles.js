import { finite } from '../utils.js';
export function candleMetrics(row) {
  if(!row||![row.open,row.high,row.low,row.close].every(finite))return null;
  const o=Number(row.open),h=Number(row.high),l=Number(row.low),c=Number(row.close),range=h-l;
  if(!(range>0))return{range:0,body:0,body_ratio:0,upper_ratio:0,lower_ratio:0,close_pos:.5,bullish:c>=o};
  const body=Math.abs(c-o),upper=h-Math.max(o,c),lower=Math.min(o,c)-l;
  return{range,body,body_ratio:body/range,upper_ratio:upper/range,lower_ratio:lower/range,close_pos:(c-l)/range,bullish:c>=o};
}

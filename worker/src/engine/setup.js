import { finite, pct } from '../utils.js';
export function detectSetup(prepared,index,metrics){
  if(index<5)return null;
  const row=prepared.rows[index],prev=prepared.rows[index-1],c=row.close,p=prev.close;
  const chg=pct(c,p),m25=prepared.sma25[index],m50=prepared.sma50[index],rsi=prepared.rsi14[index],vr=metrics.vol_ratio,cd=metrics.candle;
  const prior5=prepared.close.slice(Math.max(0,index-5),index),prior20=prepared.close.slice(Math.max(0,index-20),index);
  const low5=Math.min(...prior5),low20=Math.min(...prior20),high20=Math.max(...prior20);
  const rebound5=finite(low5)?pct(c,low5):null,draw20=finite(high20)?pct(c,high20):null;
  const reclaimed25=finite(m25)&&prev.close<m25&&c>m25,reclaimed50=finite(m50)&&prev.close<m50&&c>m50;
  const thrust=chg>=2&&cd?.close_pos>=.72&&cd?.upper_ratio<=.25&&finite(vr)&&vr>=1.2;
  if(thrust&&(reclaimed25||reclaimed50||pct(c,low20)>=6))return{code:'reversal_thrust',label:'強い反転',score:9};
  if(chg>0&&cd?.close_pos>=.62&&finite(rebound5)&&rebound5>=3&&finite(draw20)&&draw20<=-5&&finite(vr)&&vr>=.8)return{code:'bottom_reversal',label:'反転初動',score:7};
  if(index<80&&chg>0&&finite(m25)&&c>m25&&finite(vr)&&vr>=1&&finite(rsi)&&rsi<78)return{code:'ipo_momentum',label:'短期モメンタム',score:7};
  return null;
}

import { finite, mean, round } from '../utils.js';
import { isUsDst } from '../data/calendar.js';
export function volumeAt(rows,index,period=20){
  const hist=[];for(let i=Math.max(0,index-period);i<index;i++)if(finite(rows[i]?.volume))hist.push(Number(rows[i].volume));
  const avg=mean(hist),cur=finite(rows[index]?.volume)?Number(rows[index].volume):null;
  return{volume:cur,avg_volume20:avg,vol_ratio:finite(cur)&&finite(avg)&&avg>0?round(cur/avg,2):null};
}
export function intradayAdjustedRatio(rawRatio,elapsedFraction,curveFraction=null){
  if(!finite(rawRatio))return null;
  const frac=finite(curveFraction)?Number(curveFraction):Number(elapsedFraction);
  if(!(frac>0&&frac<=1))return Number(rawRatio);
  return round(Number(rawRatio)/frac,2);
}
function interpolate(points,x){
  if(x<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(x<=points[i][0]){const[a,va]=points[i-1],[b,vb]=points[i],t=(x-a)/(b-a);return va+(vb-va)*t;}
  return points.at(-1)[1];
}
export function marketVolumeCurveFraction(market,now=new Date()){
  const jst=new Date(now.getTime()+9*3600000),minute=jst.getUTCHours()*60+jst.getUTCMinutes();
  if(market==='jp'){
    let elapsed;
    if(minute<540)return null;
    if(minute<690)elapsed=minute-540;
    else if(minute<750)elapsed=150;
    else if(minute<930)elapsed=150+(minute-750);
    else return 1;
    // 個別の時刻別履歴がない場合に使う市場共通U字カーブ。引け後は必ず実績倍率へ置換する。
    return round(interpolate([[0,.02],[30,.16],[60,.25],[120,.39],[150,.45],[180,.53],[240,.65],[300,.80],[330,1]],elapsed),4);
  }
  const open=isUsDst(now)?1350:1410,elapsed=minute>=open?minute-open:minute+1440-open;
  if(elapsed<0)return null;if(elapsed>=390)return 1;
  return round(interpolate([[0,.02],[30,.15],[60,.23],[120,.35],[240,.58],[330,.75],[360,.83],[390,1]],elapsed),4);
}

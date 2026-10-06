import { finite, pct, round } from '../utils.js';
import { rsAt } from './relative-strength.js';

// All inputs are as-of index. No future bars, portfolio ownership or cost basis.
export function momentumFeatures(p,index,benchmarkMap){
  const prior=p.rows.slice(Math.max(0,index-20),index), row=p.rows[index];
  const high20=prior.length===20&&prior.every(r=>finite(r.high))?Math.max(...prior.map(r=>Number(r.high))):null;
  const low10=prior.length>=10&&prior.slice(-10).every(r=>finite(r.low))?Math.min(...prior.slice(-10).map(r=>Number(r.low))):null;
  const last5=prior.slice(-5), tight=last5.length===5&&last5.every(r=>finite(r.high)&&finite(r.low))&&finite(p.atr14[index-1])?(Math.max(...last5.map(r=>r.high))-Math.min(...last5.map(r=>r.low)))<=2*p.atr14[index-1]:null;
  const old=rsAt(p,index-1,benchmarkMap);
  return {priorHigh20:high20,priorLow10:low10,tightBase:tight,rs5Delta:finite(old.rs5)&&finite(rsAt(p,index,benchmarkMap).rs5)?round(rsAt(p,index,benchmarkMap).rs5-old.rs5):null,ret3:index>=3?pct(row.close,p.close[index-3]):null};
}

export function evaluateMomentum(a,f={}){
  const n=v=>finite(v)?Number(v):null, price=n(a.price),ma5=n(a.sma5),ma25=n(a.sma25),atr=n(a.atr14),d=n(a.div25),rs=n(a.rs5),vr=n(a.effective_vol_ratio??a.vol_ratio),cp=n(a.close_pos),wick=n(a.upper_ratio),chg=n(a.change_pct);
  const extensionState=d===null?'unknown':d<=-8?'downside':d>=15?'extreme':d>=10?'strong':d>=5?'extended':'normal';
  const extensionLabel={unknown:'判定待ち',downside:'大幅下方乖離',extreme:'極端な拡張',strong:'強い拡張',extended:'拡張',normal:'通常'}[extensionState];
  const atrDistance=price!==null&&ma25!==null&&atr>0?(price-ma25)/atr:null;
  const buffer=Math.max(price!==null?price*.003:0,atr>0?atr*.25:0);
  const above5=price!==null&&ma5!==null&&price>=ma5;
  const below5=price!==null&&ma5!==null&&price<ma5-buffer;
  const rsWeak=rs!==null&&rs<0,rsFading=n(f.rs5Delta)!==null&&f.rs5Delta<=-1;
  const breakout=price!==null&&n(f.priorHigh20)!==null&&price>f.priorHigh20;
  const failedBreak=n(a.high)!==null&&n(f.priorHigh20)!==null&&a.high>f.priorHigh20&&price!==null&&price<f.priorHigh20;
  const distribution=chg!==null&&chg<0&&vr!==null&&vr>=1.5&&cp!==null&&cp<=.35;
  const rejection=wick!==null&&wick>=.4&&cp!==null&&cp<=.4;
  const supportBreak=price!==null&&n(f.priorLow10)!==null&&price<f.priorLow10;
  const danger=[below5&&(rsWeak||rsFading),distribution,rejection,failedBreak].filter(Boolean).length;
  const expanded=d!==null&&d>=10||atrDistance!==null&&atrDistance>=3;
  // Volume/expansion alone cannot signal a top: price rejection is mandatory.
  const climax=expanded&&(rejection||failedBreak)&&danger>=2&&(vr!==null&&vr>=2||n(f.ret3)!==null&&f.ret3>=10);
  const breakdown=(supportBreak||price!==null&&ma25!==null&&price<ma25-buffer)&&below5&&(rsWeak||rsFading||distribution);
  const valid=a.data_quality?.data_valid===true;
  const enough=price!==null&&ma5!==null&&ma25!==null&&cp!==null;
  let state='unknown',label='判定待ち';
  if(valid&&enough){
    if(breakdown){state='breakdown';label='崩れ';}
    else if(climax){state='climax';label='クライマックス警戒';}
    else if(danger>=2||below5&&(rsWeak||rsFading)){state='fading';label='失速警戒';}
    else if(breakout&&f.tightBase&&rs!==null&&rs>=0&&vr!==null&&vr>=1.2&&cp>=.65){state='reacceleration';label='再加速';}
    else if((breakout||chg!==null&&chg>=2)&&above5&&rs!==null&&rs>=0&&vr!==null&&vr>=1.2&&cp>=.65&&wick!==null&&wick<.3){state='acceleration';label='加速';}
    else if(a.regime?.code==='S2'&&above5&&rs!==null&&rs>=0&&danger===0){state='continuation';label='健全継続';}
    else if(a.setup&&chg!==null&&chg>0&&cp>=.58&&danger===0){state='germination';label='発芽';}
    else {state='watch';label='確認中';}
  }
  const signals={above5,below5,rsWeak,rsFading,breakout,failedBreak,distribution,rejection,supportBreak,tightBase:f.tightBase??null};
  const missing=['price','sma5','sma25','rs5','close_pos','upper_ratio'].filter(k=>!finite(a[k]));if(vr===null)missing.push('volume');
  const quality=state==='unknown'?'unknown':missing.length?'limited':['breakdown','climax','fading'].includes(state)?'weak':['acceleration','reacceleration','continuation'].includes(state)?'strong':'developing';
  const risk=state==='unknown'?'unknown':climax?'high':danger>=2?'elevated':'none';
  const positive=['acceleration','reacceleration','continuation'].includes(state);
  const holding=state==='breakdown'?'EXIT_REVIEW':['climax','fading'].includes(state)?'REDUCE_REVIEW':positive?'HOLD':'REVIEW';
  const entry=state==='unknown'?'WAIT':['climax','breakdown','fading'].includes(state)?'AVOID':positive||state==='germination'?(expanded?'SIZE_CAUTION':'CANDIDATE'):'WAIT';
  const labels={above5:'5MA維持',below5:'5MA明確割れ',rsWeak:'市場RSマイナス',rsFading:'RS5が前日より1pt以上低下',breakout:'過去20日高値突破',failedBreak:'高値突破失敗',distribution:'出来高増の下落・安値引け',rejection:'長い上ヒゲ・弱い終値',supportBreak:'過去10日安値割れ',tightBase:'直前5日レンジが2ATR以内'};
  return {extensionState,extensionLabel,extensionAtr:round(atrDistance),extensionRisk:atrDistance!==null&&Math.abs(atrDistance)>=3?'high':'normal',momentumState:state,momentumLabel:label,momentumQuality:quality,climaxRisk:risk,entryAssessment:entry,holdingAssessment:holding,momentumEvidence:{signals,reasons:Object.keys(signals).filter(k=>signals[k]===true).map(k=>labels[k]),missing,rs5Delta:f.rs5Delta??null,priorHigh20:f.priorHigh20??null,priorLow10:f.priorLow10??null,ret3:f.ret3??null},momentumProvisional:!a.close_confirmed};
}

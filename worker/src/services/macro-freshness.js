import { expectedTradingDate, previousTradingDate, isUsDst } from '../data/calendar.js';
import { MARKET_INDICES } from '../config.js';

export const MACRO_POLL_MS=30*60*1000;
export const MACRO_STATUS_KEY='sched:macro-status:v2';
const JP=new Set(['日経平均','TOPIX','日経VI']);
const KR=new Set(['韓国KOSPI','韓国KOSDAQ']);
const US=new Set(['SOX','S&P500','Nasdaq','Dow','VIX','米10年債']);
export const REQUIRED_MACRO=['日経平均','S&P500','SOX','VIX','韓国KOSPI'];
function weekdayDate(date){let d=new Date(date+'T00:00:00Z');while([0,6].includes(d.getUTCDay()))d=new Date(+d-86400000);return d.toISOString().slice(0,10);}
export function macroFreshness(name,value,now=new Date()){
  const jst=new Date(+now+9*3600000),date=jst.toISOString().slice(0,10),minute=jst.getUTCHours()*60+jst.getUTCMinutes();
  const previous=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
  let expected=null,live=false,closeTime=null;
  if(JP.has(name)||KR.has(name)){
    const kr=KR.has(name),basis=minute<570?previous:date;
    expected=kr?weekdayDate(basis):previousTradingDate('jp',new Date(basis));
    live=expected===date&&minute>=570&&minute<960;
    if(!live)closeTime=Date.parse(expected+'T06:30:00Z');
  }else if(US.has(name)){
    // Allow delayed opening quotes 30 minutes; require today's close after 30 minutes.
    expected=expectedTradingDate('us',new Date(+now-30*60000));
    const close=Date.parse(expected+(isUsDst(new Date(expected+'T12:00:00Z'))?'T20:00:00Z':'T21:00:00Z'))-(name==='米10年債'?3600000:0);
    live=+now<close+30*60000;
    if(!live)closeTime=close;
  }else{
    const crypto=name==='BTC'||name==='ETH';
    if(crypto){live=true;expected=now.toISOString().slice(0,10);}
    else{
      // Futures use exchange-local trading dates, not the UTC calendar date.
      // Check quote age, allowing the CME daily maintenance break and weekend.
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
      const nyDate=parts.year+'-'+parts.month+'-'+parts.day,ny=new Date(nyDate+'T00:00:00Z'),dow=ny.getUTCDay(),mins=Number(parts.hour)*60+Number(parts.minute);
      const futures=name!=='ドル円',weekend=dow===6||(dow===5&&mins>=1020)||(dow===0&&mins<(futures?1110:1050));
      const maintenance=futures&&dow>=1&&dow<=4&&mins>=1020&&mins<1110;
      live=!weekend&&!maintenance;expected=value?.date||null;
      if(!live){
        const back=dow===6?1:dow===0?2:0,closedDate=new Date(+ny-back*86400000).toISOString().slice(0,10);
        closeTime=Date.parse(closedDate+(isUsDst(new Date(closedDate+'T12:00:00Z'))?'T21:00:00Z':'T22:00:00Z'));
      }
    }
  }
  const priceTime=Date.parse(value?.price_time||''),valid=value?.price!=null&&Number.isFinite(Number(value.price))&&Number(value.price)>0;
  let status=!valid?'MISSING':!value?.date||(expected&&value.date<expected)?'STALE':'CURRENT';
  if(status==='CURRENT'&&(!Number.isFinite(priceTime)||priceTime>+now+5*60000||(live&&+now-priceTime>60*60000)||(closeTime&&priceTime<closeTime-20*60000)))status='STALE';
  return {data_status:status,assessment_usable:status==='CURRENT',expected_trade_date:expected,
    freshness_label:status==='MISSING'?'取得できません':status==='STALE'?'更新遅延・参考値':live?'場中・遅延配信':'直近終値',
    calendar_note:KR.has(name)?'韓国の臨時・祝日休場は配信元時刻の確認が必要':null};
}
export function annotateMacro(items={},now=new Date()){
  return Object.fromEntries(Object.entries(MARKET_INDICES.jp).map(([name,symbol])=>[name,{symbol,...items[name],...macroFreshness(name,items[name],now)}]));
}
export function macroHealth(items={},now=new Date()){
  const values=annotateMacro(items,now),unavailable=REQUIRED_MACRO.filter(k=>!values[k].assessment_usable);
  return {status:unavailable.length?'STALE':'CURRENT',unavailable,items:values};
}

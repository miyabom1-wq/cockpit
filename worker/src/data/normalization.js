import { finite, isoDate, round } from '../utils.js';

function splitEvents(result) {
  const splits = result?.events?.splits || {};
  return Object.values(splits).map(x=>({
    time:Number(x.date || x.timestamp || 0),
    numerator:Number(x.numerator || String(x.splitRatio||'1:1').split(':')[0] || 1),
    denominator:Number(x.denominator || String(x.splitRatio||'1:1').split(':')[1] || 1)
  })).filter(x=>x.time>0&&x.numerator>0&&x.denominator>0).sort((a,b)=>a.time-b.time);
}
function nearestIndex(ts, time, before) {
  let idx = -1;
  for (let i=0;i<ts.length;i++) {
    if (before ? ts[i] < time : ts[i] >= time) idx=i;
    if (!before && idx>=0) break;
  }
  return idx;
}
function detectAlreadyAdjusted(rawCloses, timestamps, event) {
  const pre = nearestIndex(timestamps,event.time,true), post = nearestIndex(timestamps,event.time,false);
  if (pre<0||post<0||!finite(rawCloses[pre])||!finite(rawCloses[post])) return true;
  const ratio = event.numerator/event.denominator;
  if (ratio<=0) return true;
  const observed = Number(rawCloses[pre])/Number(rawCloses[post]);
  const unadjustedDistance = Math.abs(observed-ratio)/Math.max(1,ratio);
  const adjustedDistance = Math.abs(observed-1);
  return adjustedDistance <= unadjustedDistance;
}
export function normalizeYahooDaily(result) {
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const closes = q.close || [];
  const events = splitEvents(result);
  const eventModes = events.map(e=>({...e,alreadyAdjusted:detectAlreadyAdjusted(closes,ts,e)}));
  const rows=[];
  for(let i=0;i<ts.length;i++){
    if(!finite(closes[i])) continue;
    let priceFactor=1,volumeFactor=1;
    for(const ev of eventModes){
      if(ts[i] < ev.time){
        const ratio=ev.numerator/ev.denominator;
        if(!ev.alreadyAdjusted) priceFactor/=ratio;
        volumeFactor*=ratio;
      }
    }
    const close=Number(closes[i])*priceFactor;
    const open=finite(q.open?.[i])?Number(q.open[i])*priceFactor:close;
    const high=finite(q.high?.[i])?Number(q.high[i])*priceFactor:Math.max(open,close);
    const low=finite(q.low?.[i])?Number(q.low[i])*priceFactor:Math.min(open,close);
    const volume=finite(q.volume?.[i])?Math.max(0,Number(q.volume[i])*volumeFactor):0;
    if(!(close>0&&open>0&&high>0&&low>0)) continue;
    rows.push({
      time:Number(ts[i]),date:isoDate(Number(ts[i])*1000),open,high,low,close,volume,
      adj_close:finite(adj[i])?Number(adj[i]):null,
      total_return_factor:finite(adj[i])&&close>0?Number(adj[i])/close:null
    });
  }
  return {
    rows,
    meta:{
      symbol:result?.meta?.symbol || null,
      currency:result?.meta?.currency || null,
      exchange:result?.meta?.exchangeName || result?.meta?.fullExchangeName || null,
      market_state:result?.meta?.marketState || null,
      regular_market_price:finite(result?.meta?.regularMarketPrice)?Number(result.meta.regularMarketPrice):null,
      regular_market_time:result?.meta?.regularMarketTime || null,
      chart_previous_close:finite(result?.meta?.chartPreviousClose)?Number(result.meta.chartPreviousClose):null,
      source_adjustment:'Yahoo quote OHLC; split events normalized only when raw discontinuity indicates unadjusted data; dividends excluded from technical OHLC',
      split_events:eventModes.map(x=>({date:isoDate(x.time*1000),ratio:round(x.numerator/x.denominator,6),raw_already_adjusted:x.alreadyAdjusted}))
    }
  };
}

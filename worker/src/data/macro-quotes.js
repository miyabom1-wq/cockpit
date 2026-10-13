import { normalizeYahooDaily } from './normalization.js';
import { round, finite } from '../utils.js';
import { providerSymbolMatches } from '../services/integrity.js';

function returns(rows){const last=rows.at(-1);return n=>rows.length>n?round((last.close/rows.at(-1-n).close-1)*100):null;}
export function yahooMacroQuote(raw,symbol,now=new Date()){
  if(!providerSymbolMatches(symbol,raw?.meta?.symbol))throw Error('provider symbol mismatch');
  const norm=normalizeYahooDaily(raw),meta=raw.meta||{},rows=norm.rows.map(r=>({...r}));
  const stamp=Number(meta.regularMarketTime),price=Number(meta.regularMarketPrice);
  let date=rows.at(-1)?.date;
  if(stamp>0&&Number.isFinite(price)&&price>0){
    date=new Intl.DateTimeFormat('en-CA',{timeZone:meta.exchangeTimezoneName||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000));
    // Yahoo can publish a fresh quote while today's daily bar is still null.
    // Replace/append using the quote's trading date, never today's fetch date.
    const i=rows.findIndex(r=>r.date===date);
    if(i>=0)rows[i]={...rows[i],close:price};
    else if(!rows.length||date>rows.at(-1).date)rows.push({date,close:price});
    else throw Error('quote timestamp older than price history');
  }
  const last=rows.at(-1);if(!last)throw Error('empty price history');
  const ret=returns(rows);
  return {symbol,provider_symbol:meta.symbol,source:'Yahoo Finance',price:last.close,
    change_pct:finite(meta.regularMarketChangePercent)?Number(meta.regularMarketChangePercent):ret(1),
    ret5:ret(5),ret20:ret(20),date:last.date,price_time:stamp>0?new Date(stamp*1000).toISOString():null,
    fetched_at:now.toISOString(),market_state:meta.marketState||null};
}

export function parseTopixPage(html,now=new Date()){
  const embedded=html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if(!embedded)throw Error('TOPIX structured data unavailable');
  const state=JSON.parse(embedded[1]),board=state.mainDomesticIndexPriceBoard?.indexPrices;
  if(board?.code!=='998405.T'||board.name!=='TOPIX')throw Error('TOPIX source identity mismatch');
  const series=state.mainItemDetailChartSetting?.timeSeriesData;
  const rows=(series?.histories||[]).filter(r=>Number(r.closePrice)>0).map(r=>({date:String(r.baseDatetime).slice(0,10),close:Number(r.closePrice)})).sort((a,b)=>a.date.localeCompare(b.date));
  const date=String(series?.latestHistoryBaseDatetime||'').slice(0,10),last=rows.at(-1);
  const number=x=>Number(String(x??'').replaceAll(',',''));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||last?.date!==date||!/^\d{2}:\d{2}$/.test(board.japanUpdateTime)||!(number(board.price)>0))throw Error('TOPIX timestamp/price incomplete');
  // Do not label a newer price with an old chart date.
  const quoteDay=state.mainDomesticIndexDetail?.indexPrices?.openPriceDatetime;
  if(quoteDay!==date.slice(5).replace('-','/'))throw Error('TOPIX quote/history date mismatch');
  last.close=number(board.price);const ret=returns(rows);
  return {symbol:'^TOPX',provider_symbol:'998405.T',source:'Yahoo!ファイナンス（TOPIX指数）',source_url:'https://finance.yahoo.co.jp/quote/998405.T',
    price:last.close,change_pct:board.changePriceRate?number(board.changePriceRate):ret(1),ret5:ret(5),ret20:ret(20),date,
    price_time:new Date(date+'T'+board.japanUpdateTime+':00+09:00').toISOString(),fetched_at:now.toISOString(),market_state:null};
}
export async function fetchTopixQuote(now=new Date()){
  const response=await fetch('https://finance.yahoo.co.jp/quote/998405.T',{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'},cf:{cacheTtl:120},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('TOPIX HTTP '+response.status);
  return parseTopixPage(await response.text(),now);
}

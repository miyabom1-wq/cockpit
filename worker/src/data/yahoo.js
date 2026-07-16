const CHART_BASES = [
  'https://query1.finance.yahoo.com/v8/finance/chart/',
  'https://query2.finance.yahoo.com/v8/finance/chart/'
];
const HEADERS = {
  'User-Agent':'Mozilla/5.0 (compatible; VANTAGE/35.0)',
  'Accept':'application/json,text/plain,*/*',
  'Accept-Language':'en-US,en;q=0.9'
};
export async function fetchYahooChart(symbol,{range='2y',interval='1d',cacheTtl=300}={}) {
  let last = null;
  for (const base of CHART_BASES) {
    try {
      const url = `${base}${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=div%2Csplits&includePrePost=false`;
      const res = await fetch(url,{headers:HEADERS,cf:{cacheTtl}});
      if (!res.ok) { last = new Error(`${symbol} HTTP ${res.status}`); continue; }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (result) return result;
      last = new Error(json?.chart?.error?.description || `${symbol} result missing`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`${symbol} fetch failed`);
}
export async function lookupSymbol(symbol) {
  const result = await fetchYahooChart(symbol,{range:'5d',cacheTtl:60});
  const meta = result.meta || {};
  const q = result.indicators?.quote?.[0] || {};
  const closes = (q.close || []).filter(Number.isFinite);
  const price = Number(meta.regularMarketPrice ?? closes.at(-1));
  if (!Number.isFinite(price)) return null;
  return {
    symbol:String(meta.symbol || symbol).toUpperCase(),
    name:String(meta.longName || meta.shortName || meta.symbol || symbol),
    price,
    currency:meta.currency || null,
    exchange:meta.exchangeName || meta.fullExchangeName || null,
    market_state:meta.marketState || null,
    regular_market_time:meta.regularMarketTime || null
  };
}

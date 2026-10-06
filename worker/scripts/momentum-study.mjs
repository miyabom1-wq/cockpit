import { readFileSync } from 'node:fs';
import { backtestSeries } from '../src/services/backtest.js';
const file=process.argv[2];
if(!file){console.error('Usage: node scripts/momentum-study.mjs input.json > result.json\nInput: {rows:[{date,open,high,low,close,volume}],benchmarkRows:[...],symbol,name,market}');process.exit(1)}
const x=JSON.parse(readFileSync(file,'utf8'));
if(!Array.isArray(x.rows)||x.rows.length<221)throw Error('At least 221 daily rows required (200 warmup + 20 forward sessions)');
console.log(JSON.stringify(backtestSeries(x.rows,x.benchmarkRows||[],{symbol:x.symbol||'TEST',name:x.name||x.symbol||'TEST',market:x.market||'us'}).momentumStudy,null,2));

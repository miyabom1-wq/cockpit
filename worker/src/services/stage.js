import { LIMITS, MARKET_INDICES, ENGINE_VERSION, BUILD_ID, themeOf } from '../config.js';
import { fetchYahooChart } from '../data/yahoo.js';
import { normalizeYahooDaily } from '../data/normalization.js';
import { expectedTradingDate, isUsDst } from '../data/calendar.js';
import { prepareSeries, analyzePreparedAt, analyzeSeriesLatest } from '../engine/analysis.js';
import { benchmarkValues, percentile } from '../engine/relative-strength.js';
import { classifyCandidate } from '../engine/candidate-board.js';
import { marketVolumeCurveFraction } from '../engine/volume.js';
import { getStockList, focusTier } from '../storage/stocklist.js';
import { KEYS } from '../storage/kv-schema.js';
import { finite, parseJson, nowIso, stableHash, round, jstDate } from '../utils.js';
import { mergeMacroSnapshots, evaluateRiskGate, providerSymbolMatches } from './integrity.js';
import { enrichRowsWithMargin } from './margin-supply.js';

const WORK_TTL=3*86400;
const INDEX_CACHE_TTL=120;
function macroWithSnapshotTime(stage){return Object.fromEntries(Object.entries(stage?.macro||{}).map(([k,v])=>[k,{...v,snapshot_updated_at:v?.snapshot_updated_at||stage?.updated_at||null}]));}
async function canonicalMacro(env,incoming={}){
  const saved=parseJson(await env.COCKPIT_KV.get(KEYS.macroCurrent),{items:{}}),items=mergeMacroSnapshots(saved.items||{},incoming);
  const payload={updated_at:nowIso(),items};await env.COCKPIT_KV.put(KEYS.macroCurrent,JSON.stringify(payload));return payload;
}
function activeLimit(m){return m==='jp'?LIMITS.jpMax:LIMITS.usLead;}
function partsFor(m){return Math.ceil(activeLimit(m)/LIMITS.batchSize);}
function stageWorkingKey(id,part){return`stage:working:${id}:part:${part}`;}
function stageMetaKey(id){return`stage:working:${id}:meta`;}
function benchmarkKey(id){return`stage:working:${id}:benchmark`;}
function manualKey(m){return`stage:manual:${m}:current`;}
function modeNow(market,now=new Date()){
  const jst=new Date(now.getTime()+9*3600000),min=jst.getUTCHours()*60+jst.getUTCMinutes();
  if(market==='jp')return min>=540&&min<930?'intraday':min>=960?'confirmed':'confirmed';
  const dst=isUsDst(now),open=dst?1350:1410,close=dst?300:360;
  return min>=open||min<close?'intraday':'confirmed';
}
function expectedDateFor(market,now=new Date()){return expectedTradingDate(market,now);}
function confirmedByProvider(market,meta,expectedDate,requestedKind){
  if(requestedKind!=='confirmed')return false;
  const state=String(meta?.market_state||'').toUpperCase();
  if(['CLOSED','POST','POSTPOST'].includes(state))return true;
  const t=Number(meta?.regular_market_time||0);if(!(t>0)||!expectedDate)return false;
  const threshold=market==='jp'?Date.parse(`${expectedDate}T06:30:00Z`):Date.parse(`${expectedDate}T${isUsDst(new Date(`${expectedDate}T12:00:00Z`))?'20':'21'}:00:00Z`);
  return t*1000>=threshold;
}
function snapshotId(market,tradeDate,kind,label='manual'){return`${market.toUpperCase()}-${tradeDate}-${String(kind).toUpperCase()}-${label}-${BUILD_ID}`;}
async function resolveManualSnapshot(env,market,part){
  if(part===1){const kind=modeNow(market),date=expectedDateFor(market),id=snapshotId(market,date,kind,`M${Date.now().toString(36)}`);await env.COCKPIT_KV.put(manualKey(market),JSON.stringify({id,kind,date,created_at:nowIso()}),{expirationTtl:3600});return{id,kind,date};}
  const raw=await env.COCKPIT_KV.get(manualKey(market)),v=parseJson(raw,null);
  if(v?.id)return{id:v.id,kind:v.kind,date:v.date};
  return resolveManualSnapshot(env,market,1);
}
async function getBenchmark(env,market,id){
  const raw=await env.COCKPIT_KV.get(benchmarkKey(id));if(raw){const v=parseJson(raw,null);if(v?.rows&&v?.secondary_rows)return v;}
  const primarySymbol=market==='jp'?'^N225':'^GSPC',secondarySymbol=market==='jp'?'^TOPX':'^IXIC';
  const [primary,secondary]=await Promise.all([fetchYahooChart(primarySymbol,{range:'2y',cacheTtl:300}),fetchYahooChart(secondarySymbol,{range:'2y',cacheTtl:300})]);
  const p=normalizeYahooDaily(primary),s=normalizeYahooDaily(secondary),payload={symbol:primarySymbol,rows:p.rows,meta:p.meta,secondary_symbol:secondarySymbol,secondary_rows:s.rows,secondary_meta:s.meta,created_at:nowIso()};
  await env.COCKPIT_KV.put(benchmarkKey(id),JSON.stringify(payload),{expirationTtl:WORK_TTL});return payload;
}
async function fetchMacro(market){
  const fetchedAt=nowIso(),entries=Object.entries(MARKET_INDICES[market]||{}),results=await Promise.allSettled(entries.map(async([name,symbol])=>{
    const norm=normalizeYahooDaily(await fetchYahooChart(symbol,{range:'1mo',cacheTtl:INDEX_CACHE_TTL})),p=prepareSeries(norm.rows),i=p.rows.length-1;if(i<0)return[name,null];
    const providerSymbol=String(norm.meta.symbol||'').toUpperCase();if(providerSymbol&&!providerSymbolMatches(symbol,providerSymbol))throw new Error(`${symbol} provider symbol mismatch: ${providerSymbol}`);
    const a=analyzePreparedAt(p,i,{symbol,name,market,benchmarkMap:new Map(),expectedDate:null,closeConfirmed:false,snapshotId:null});
    return[name,{symbol,provider_symbol:providerSymbol||symbol,price:a.price,change_pct:a.change_pct,ret5:a.ret5,ret20:a.ret20,date:a.date,price_time:norm.meta.regular_market_time?new Date(norm.meta.regular_market_time*1000).toISOString():null,fetched_at:fetchedAt,market_state:norm.meta.market_state}];
  }));
  return Object.fromEntries(results.filter(x=>x.status==='fulfilled'&&x.value?.[1]).map(x=>x.value));
}
export async function refreshMacroSnapshots(env){
  const incoming=await fetchMacro('jp'),payload=await canonicalMacro(env,incoming);
  return{ok:true,schema:'macro-independent-v1',updated_at:payload.updated_at,received:Object.keys(incoming).length,items:payload.items};
}

async function analyzeOne(symbol,name,market,benchMap,secondaryBenchMap,opts){
  try{
    const norm=normalizeYahooDaily(await fetchYahooChart(symbol,{range:'2y',cacheTtl:opts.cacheTtl??(opts.kind==='intraday'?60:300)})),providerSymbol=String(norm.meta.symbol||'').toUpperCase();
    if(providerSymbol&&!providerSymbolMatches(symbol,providerSymbol))throw new Error(`銘柄コード不一致: requested ${symbol} / provider ${providerSymbol}`);
    const p=prepareSeries(norm.rows),i=p.rows.length-1;
    const quoteNow=norm.meta.regular_market_time?new Date(norm.meta.regular_market_time*1000):new Date(),curve=opts.kind==='intraday'?marketVolumeCurveFraction(market,quoteNow):1,confirmed=confirmedByProvider(market,norm.meta,opts.tradeDate,opts.kind);
    const a=analyzePreparedAt(p,i,{symbol,name,market,benchmarkMap:benchMap,secondaryBenchmarkMap:secondaryBenchMap,expectedDate:opts.tradeDate,closeConfirmed:confirmed,requireCloseConfirmed:opts.kind==='confirmed',snapshotId:opts.snapshotId,source:'Yahoo Finance',context:{},volumeCurveFraction:curve,volumeCurveLabel:'市場共通U字カーブ（場中暫定）'});
    if(a){a.price_time=norm.meta.regular_market_time?new Date(norm.meta.regular_market_time*1000).toISOString():null;a.market_state=norm.meta.market_state;a.provider_symbol=providerSymbol||symbol;a.focus_tier=opts.focusTier;a.source_adjustment=norm.meta.source_adjustment;if(a.audit?.data)a.audit.data.provider_symbol=a.provider_symbol;}
    return a;
  }catch(e){return{symbol,name,market,focus_tier:opts.focusTier,entry_lane:'D',entry_label:'データ取得失敗',entry_quality:'invalid',data_quality:{data_valid:false,stale:true,reasons:[e?.message||String(e)],expected_trade_date:opts.tradeDate,close_confirmed:false,snapshot_id:opts.snapshotId},audit:{data:{quality:{data_valid:false,reasons:[e?.message||String(e)]},snapshot_id:opts.snapshotId,engine:ENGINE_VERSION}}};}
}
function deriveContext(stocks,ranking,market){
  const rsValues=stocks.map(x=>x.rs5),rankMap=new Map((ranking?.items||[]).map(x=>[x.symbol,x.rank]));
  const themeGroups=new Map();for(const s of stocks){const t=s.theme||themeOf(s.symbol);if(!themeGroups.has(t))themeGroups.set(t,[]);themeGroups.get(t).push(s);}
  for(const s of stocks){
    const peers=(themeGroups.get(s.theme)||[]).filter(x=>x.symbol!==s.symbol&&finite(x.rs5)),themeRs=peers.length?peers.reduce((a,b)=>a+Number(b.rs5),0)/peers.length:null;
    const context={turnover_rank:rankMap.get(s.symbol)||null,rs_percentile:percentile(s.rs5,rsValues),theme_rs:finite(themeRs)?round(themeRs):null,theme_peer_count:peers.length};
    const c=classifyCandidate(s,context);s.entry_lane=c.lane;s.entry_label=c.label;s.entry_quality=c.quality;s.entry_reason=c.reasons;s.risk_reason=c.risks;s.rs_percentile=context.rs_percentile;s.turnover_rank=context.turnover_rank;s.theme_rs=context.theme_rs;s.theme_peer_count=context.theme_peer_count;
    if(s.audit){s.audit.candidate={lane:c.lane,label:c.label,quality:c.quality,conditions:c.conditions,reasons:c.reasons,risks:c.risks};s.audit.relative_strength={market_rs5:s.rs5,market_rs20:s.rs20,secondary_rs5:s.secondary_rs5,secondary_rs20:s.secondary_rs20,secondary_name:market==='jp'?'TOPIX':'Nasdaq',registered_percentile:s.rs_percentile,theme_ex_self:s.theme_rs,theme_peer_count:s.theme_peer_count,turnover_rank:s.turnover_rank};}
  }
}
function applyRiskGate(rows,riskGate){for(const row of rows){row.market_gate=riskGate.level;row.entry_allowed=!(riskGate.block_new_entries&&['A','B'].includes(row.entry_lane));row.entry_block_reason=row.entry_allowed?null:riskGate.label;}}
function buildMomentum(market,store){
  const labels={A:'強い継続候補',B:'反転初動',C:'押し目監視',D:'監視継続',E:'警戒'},rows=Object.values(store.stocks||{}),riskGate=store.risk_gate||evaluateRiskGate(market,store.macro||{});applyRiskGate(rows,riskGate);
  const board=Object.keys(labels).map(key=>({key,label:labels[key],rows:rows.filter(x=>x.entry_lane===key).sort((a,b)=>(b.entry_sort_score??b.rs_percentile??-1)-(a.entry_sort_score??a.rs_percentile??-1))}));
  return{ready:true,market,updated_at:store.updated_at,snapshot_id:store.snapshot_id,trade_date:store.trade_date,complete:store.complete,risk_gate:riskGate,rows,board,analyzer_version:ENGINE_VERSION};
}
function buildNoTrade(market,store){
  const rows=Object.values(store.stocks||{}),hot=rows.filter(x=>finite(x.rsi14)&&x.rsi14>=78).length,extreme=rows.filter(x=>finite(x.div25)&&x.div25>=10).length,dips=rows.filter(x=>x.entry_lane==='C').length,wicks=rows.filter(x=>finite(x.upper_ratio)&&x.upper_ratio>=.4).length,riskGate=store.risk_gate||evaluateRiskGate(market,store.macro||{});
  let recLevel=riskGate.level==='stress'?'stress':'normal';if(recLevel!=='stress'&&rows.length&&((hot+extreme)/rows.length>=.25))recLevel='strong';else if(recLevel!=='stress'&&rows.length&&((hot+extreme)/rows.length>=.12))recLevel='recommend';
  const signals=riskGate.level==='stress'?[{label:riskGate.label,detail:(riskGate.reasons||[]).join(' / '),block_new_entries:true}]:[];
  return{market,updated_at:store.updated_at,snapshot_id:store.snapshot_id,recLevel,risk_gate:riskGate,summary:{extreme_pct:rows.length?round(extreme/rows.length*100,1):0,rsi_hot:hot,healthy_dips:dips,shooting_stars:wicks},signals};
}
async function commitIfComplete(env,market,id,meta){
  const expected=meta.parts,parts=[];for(let i=1;i<=expected;i++){const raw=await env.COCKPIT_KV.get(stageWorkingKey(id,i));if(!raw)return{committed:false};parts.push(parseJson(raw,{stocks:[]}));}
  const stocks=parts.flatMap(x=>x.stocks||[]),partMacro=parts.find(x=>x.macro)?.macro||{},saved=parseJson(await env.COCKPIT_KV.get(KEYS.macroCurrent),{items:{}}),macro=mergeMacroSnapshots(saved.items||{},partMacro),riskGate=evaluateRiskGate(market,macro);
  await canonicalMacro(env,macro);
  const ranking=parseJson(await env.COCKPIT_KV.get(KEYS.ranking(market)),null);deriveContext(stocks,ranking,market);if(market==='jp')await enrichRowsWithMargin(env,stocks);applyRiskGate(stocks,riskGate);
  const registered=await getStockList(env,market),validConfirmed=stocks.filter(x=>x.data_quality?.data_valid&&x.data_quality?.close_confirmed).length;
  const store={schema:'stage-v50',engine_version:ENGINE_VERSION,build:BUILD_ID,market,snapshot_id:id,trade_date:meta.tradeDate,kind:meta.kind,complete:true,updated_at:nowIso(),price_time:stocks.map(x=>x.price_time).filter(Boolean).sort().at(-1)||null,freshness:meta.kind==='confirmed'?'確定終値・大引け':'場中・暫定',vol_partial:meta.kind!=='confirmed',close_verification:{trade_date:meta.tradeDate,verified:validConfirmed,total:stocks.length,ratio:stocks.length?round(validConfirmed/stocks.length*100,1):0},focus_counts:market==='jp'?{core:Math.min(registered.length,LIMITS.jpCore),radar:Math.max(0,Math.min(registered.length,LIMITS.jpMax)-LIMITS.jpCore)}:{lead:Math.min(registered.length,LIMITS.usLead),archive:Math.max(0,registered.length-LIMITS.usLead)},macro,risk_gate:riskGate,stocks:Object.fromEntries(stocks.map(x=>[x.symbol,x]))};
  const momentum=buildMomentum(market,store),notrade=buildNoTrade(market,store);
  await Promise.all([env.COCKPIT_KV.put(KEYS.stage(market),JSON.stringify(store)),env.COCKPIT_KV.put(KEYS.momentum(market),JSON.stringify(momentum)),env.COCKPIT_KV.put(KEYS.noTrade(market),JSON.stringify(notrade))]);
  return{committed:true,store,momentum,notrade};
}
export function batchFreshnessRatios(stocks=[],tradeDate=null){
  const total=stocks.length,session=stocks.filter(x=>!tradeDate||x?.date===tradeDate).length,confirmed=stocks.filter(x=>(!tradeDate||x?.date===tradeDate)&&x?.data_quality?.close_confirmed).length;
  return{total,session,confirmed,session_ratio:total?round(session/total*100,1):0,confirmed_ratio:total?round(confirmed/total*100,1):0};
}
export function freshnessBelowFloor(freshness={},metric,floor){
  const required=Number(floor);
  if(!Number.isFinite(required))return false;
  if((Number(freshness?.total)||0)===0)return false;
  return Number(freshness?.[metric])<required;
}

export async function runStageBatch(env,batchKey,options={}){
  const match=String(batchKey||'').match(/^(jp|us)(\d+)$/);if(!match)throw new Error('unknown batch: '+batchKey);
  const market=match[1],part=Number(match[2]),parts=options.parts||partsFor(market);if(part<1||part>parts)throw new Error('batch out of range');
  let id=options.snapshotId,kind=options.kind,tradeDate=options.tradeDate;
  if(!id){const m=await resolveManualSnapshot(env,market,part);id=m.id;kind=m.kind;tradeDate=m.date;}
  kind=kind||modeNow(market);tradeDate=tradeDate||expectedDateFor(market);
  const list=(await getStockList(env,market)).slice(0,activeLimit(market)),slice=list.slice((part-1)*LIMITS.batchSize,part*LIMITS.batchSize);
  const benchmark=await getBenchmark(env,market,id),benchMap=benchmarkValues(benchmark.rows),secondaryBenchMap=benchmarkValues(benchmark.secondary_rows||[]);
  const stocks=await Promise.all(slice.map((it,idx)=>analyzeOne(it.symbol,it.name,market,benchMap,secondaryBenchMap,{kind,tradeDate,snapshotId:id,focusTier:focusTier(market,(part-1)*LIMITS.batchSize+idx)})));
  const freshness=batchFreshnessRatios(stocks,tradeDate),sessionFloor=Number(options.minSessionRatio),confirmedFloor=Number(options.minConfirmedRatio);
  if(freshnessBelowFloor(freshness,'session_ratio',sessionFloor))throw new Error(`session freshness ${freshness.session_ratio}% below ${sessionFloor}%`);
  if(freshnessBelowFloor(freshness,'confirmed_ratio',confirmedFloor))throw new Error(`confirmed freshness ${freshness.confirmed_ratio}% below ${confirmedFloor}%`);
  const macro=part===1?(await canonicalMacro(env,await fetchMacro(market))).items:null,payload={market,part,parts,snapshot_id:id,kind,trade_date:tradeDate,created_at:nowIso(),stocks,batch_freshness:freshness,...(macro?{macro}:{})};
  await env.COCKPIT_KV.put(stageWorkingKey(id,part),JSON.stringify(payload),{expirationTtl:WORK_TTL});
  const metaRaw=await env.COCKPIT_KV.get(stageMetaKey(id)),meta=parseJson(metaRaw,{market,parts,completed:[],kind,tradeDate,created_at:nowIso()});if(!meta.completed.includes(part))meta.completed.push(part);meta.updated_at=nowIso();await env.COCKPIT_KV.put(stageMetaKey(id),JSON.stringify(meta),{expirationTtl:WORK_TTL});
  const commit=meta.completed.length>=parts?await commitIfComplete(env,market,id,meta):{committed:false};
  return{ok:true,market,part,parts,snapshot_id:id,kind,trade_date:tradeDate,count:stocks.length,completed_parts:meta.completed.sort((a,b)=>a-b),committed:commit.committed,batch_freshness:freshness};
}
export async function getStage(env,market){
  const m=market==='us'?'us':'jp',stage=parseJson(await env.COCKPIT_KV.get(KEYS.stage(m)),{market:m,complete:false,stocks:{},macro:{},focus_counts:{}}),other=parseJson(await env.COCKPIT_KV.get(KEYS.stage(m==='jp'?'us':'jp')),{macro:{}}),canonical=parseJson(await env.COCKPIT_KV.get(KEYS.macroCurrent),{items:{}});
  const macro=mergeMacroSnapshots(macroWithSnapshotTime(other),macroWithSnapshotTime(stage),canonical.items||{}),riskGate=evaluateRiskGate(m,macro),stocks=stage.stocks||{},rows=Object.values(stocks);if(m==='jp')await enrichRowsWithMargin(env,rows);applyRiskGate(rows,riskGate);
  return{...stage,market:m,macro,risk_gate:riskGate,stocks};
}
export async function getMomentum(env,market){
  const m=market==='us'?'us':'jp',stored=parseJson(await env.COCKPIT_KV.get(KEYS.momentum(m)),{ready:false,market:m,rows:[],board:[]}),stage=await getStage(env,m);
  if(!stored.ready)return{...stored,risk_gate:stage.risk_gate};
  const rows=(stored.rows||[]).map(x=>stage.stocks?.[x.symbol]||x);applyRiskGate(rows,stage.risk_gate);const bySymbol=new Map(rows.map(x=>[x.symbol,x]));
  return{...stored,risk_gate:stage.risk_gate,rows,board:(stored.board||[]).map(l=>({...l,rows:(l.rows||[]).map(x=>bySymbol.get(x.symbol)||x).sort((a,b)=>(b.entry_sort_score??b.rs_percentile??-1)-(a.entry_sort_score??a.rs_percentile??-1))}))};
}
export async function getNoTrade(env,market){
  const m=market==='us'?'us':'jp',stored=parseJson(await env.COCKPIT_KV.get(KEYS.noTrade(m)),{market:m,recLevel:'normal',summary:{},signals:[]}),stage=await getStage(env,m),riskGate=stage.risk_gate;
  if(riskGate.level!=='stress')return{...stored,risk_gate:riskGate};
  return{...stored,recLevel:'stress',risk_gate:riskGate,signals:[{label:riskGate.label,detail:(riskGate.reasons||[]).join(' / '),block_new_entries:true}]};
}
export async function getReentry(env,market){const m=await getMomentum(env,market);return{ok:true,market,items:(m.rows||[]).filter(x=>x.entry_lane==='B')};}
export async function analyzeSymbolsNow(env,items,market,{label='WATCH',cacheTtl=30}={}){
  const m=market==='us'?'us':'jp',list=(items||[]).filter(x=>x?.symbol),date=expectedDateFor(m),kind=modeNow(m),id=snapshotId(m,date,kind,`${label}-${stableHash(list.map(x=>x.symbol).join('|')+Date.now())}`);
  if(!list.length)return{market:m,date,kind,snapshot_id:id,items:[]};
  const benchmark=await getBenchmark(env,m,id),benchMap=benchmarkValues(benchmark.rows),secondaryBenchMap=benchmarkValues(benchmark.secondary_rows||[]);
  const rows=await Promise.all(list.map((it,idx)=>analyzeOne(it.symbol,it.name||it.symbol,m,benchMap,secondaryBenchMap,{kind,tradeDate:date,snapshotId:id,focusTier:it.focus_tier||'watch',cacheTtl,sequence:idx})));if(m==='jp')await enrichRowsWithMargin(env,rows);
  return{market:m,date,kind,snapshot_id:id,items:rows};
}
export async function analyzeSymbolNow(env,symbol,name,market){
  const result=await analyzeSymbolsNow(env,[{symbol,name}],market,{label:'WATCH',cacheTtl:30});
  const a=result.items[0]||null;if(a)a.focus_tier='watch';return a;
}
export function scheduleSnapshotOptions(market,label,kind,tradeDate){return{snapshotId:snapshotId(market,tradeDate,kind,label),kind,tradeDate,parts:partsFor(market)};}
export function marketParts(market){return partsFor(market);}

import { LIMITS } from '../config.js';
import { KEYS } from '../storage/kv-schema.js';
import { getStockList, saveStockList } from '../storage/stocklist.js';
import { getExplorer, getEnrichedRanking, getRanking } from './ranking.js';
import { parseJson, nowIso, finite, round, jstDate } from '../utils.js';

const IMPORTANT_THEMES=[
  ['メモリ・ストレージ',['285A.T','MU','SNDK','WDC','STX']],
  ['半導体装置',['8035.T','6857.T','6146.T','7735.T','6920.T','6525.T','6315.T','AMAT','LRCX','KLAC','ASML']],
  ['AI半導体・ロジック',['NVDA','AVGO','AMD','TSM','ARM','MRVL','QCOM','CRDO','ALAB','6526.T','6723.T']],
  ['半導体材料',['4063.T','3436.T','4004.T','4062.T','4183.T','6890.T']],
  ['電線・AI物理',['5803.T','5801.T','5802.T','VRT','ETN','GEV']],
  ['電力・原子力',['9501.T','9502.T','9503.T','CEG','VST','CCJ']],
  ['ネットワーク・光',['ANET','CIEN','COHR','LITE']],
  ['メガテック・AIソフト',['GOOGL','AMZN','META','MSFT','AAPL','ORCL','PLTR','NOW']],
  ['防衛・重工',['7011.T','7012.T','7013.T','6503.T']],
  ['金融',['8306.T','8316.T','8411.T','8766.T','HOOD']]
].map(([name,symbols])=>[name,new Set(symbols)]);

const DEFAULT_CONFIG=Object.freeze({
  mode:'guarded_auto',
  min_history_days:7,
  weekly_swap_limit:2,
  theme_minimum:2,
  candidate_min_score:58,
  score_advantage:18,
  proposal_ttl_days:7,
  jp_target_mode:'current',
  us_lead_target:LIMITS.usLead
});

function themeName(symbol,fallback='その他'){
  const s=String(symbol||'').toUpperCase();
  for(const [name,set] of IMPORTANT_THEMES)if(set.has(s))return name;
  return fallback||'その他';
}
function tierFor(market,index){if(market==='jp')return index<LIMITS.jpCore?'core':'radar';return index<LIMITS.usLead?'lead':'archive';}
function laneValue(lane){return({A:26,B:22,C:10,D:-5,E:-22})[lane]??-2;}
function rankPoints(rank,market){const r=Number(rank);if(!finite(r))return 0;if(r<=20)return 34;if(r<=50)return 27;if(r<=100)return 20;if(r<=200)return market==='jp'?12:7;if(r<=300)return market==='jp'?6:0;return 0;}
function persistence(history,symbol,limit){const snaps=(history?.snapshots||[]).slice(-limit);return snaps.filter(s=>(s.items||[]).some(x=>x.symbol===symbol)).length;}
function latestRank(ranking,symbol){return (ranking?.items||[]).find(x=>x.symbol===symbol)?.rank??null;}
function analysisScore(row={}){
  let score=laneValue(row.entry_lane);
  if(finite(row.rs5))score+=Math.max(-14,Math.min(18,Number(row.rs5)*2));
  if(finite(row.rs20))score+=Math.max(-10,Math.min(14,Number(row.rs20)));
  if(finite(row.effective_vol_ratio??row.vol_ratio))score+=Math.max(-4,Math.min(12,(Number(row.effective_vol_ratio??row.vol_ratio)-1)*12));
  if(row.stage_code==='S2')score+=9;
  if(finite(row.div25)&&Math.abs(Number(row.div25))<=6)score+=5;
  if(finite(row.rsi14??row.rsi)&&Number(row.rsi14??row.rsi)>=80)score-=10;
  if(finite(row.div25)&&Number(row.div25)>=14)score-=12;
  return score;
}
export function scoreUniverseItem({item={},analysis={},rank=null,presence=0,market='jp',candidate=false}={}){
  let score=rankPoints(rank,market)+Math.min(18,presence*3)+analysisScore(analysis);
  if(candidate&&analysis.new_entry)score+=8;
  if(candidate&&finite(analysis.rank_change)&&Number(analysis.rank_change)>=20)score+=Math.min(12,Number(analysis.rank_change)/3);
  if(item.pinned)score+=100;
  return round(Math.max(-50,Math.min(160,score)),1);
}
export function buildThemeCoverage(jpList=[],usList=[]){
  const count=(list,name)=>list.filter(x=>themeName(x.symbol,x.theme)===name).length;
  return IMPORTANT_THEMES.map(([name])=>{const jp=count(jpList,name),us=count(usList,name),total=jp+us;return{name,jp,us,total,status:total===0?'missing':total<2?'thin':'covered'};});
}
function compactAnalysis(x={}){return{entry_lane:x.entry_lane??null,rs5:x.rs5??null,rs20:x.rs20??null,vol_ratio:x.effective_vol_ratio??x.vol_ratio??null,stage_code:x.stage_code??null,div25:x.div25??null,rsi14:x.rsi14??x.rsi??null,new_entry:Boolean(x.new_entry),rank_change:x.rank_change??null};}
function protectedReason(item,protectedSet){if(item.pinned)return'手動固定';if(protectedSet.has(item.symbol))return'保有またはウォッチ';return null;}
function proposalReasonCandidate(c){const xs=[];if(c.rank)xs.push(`売買代金${c.rank}位`);if(c.presence>=3)xs.push(`ランキング${c.presence}日確認`);if(['A','B'].includes(c.analysis.entry_lane))xs.push(`${c.analysis.entry_lane}候補`);if(finite(c.analysis.rs5)&&c.analysis.rs5>0)xs.push(`RS5 +${round(c.analysis.rs5,1)}%`);if(finite(c.analysis.vol_ratio)&&c.analysis.vol_ratio>=1.2)xs.push(`出来高${round(c.analysis.vol_ratio,1)}倍`);return xs.slice(0,4).join(' / ')||'ランキング・探索から浮上';}
function proposalReasonDrop(x){const xs=[];if(!x.rank)xs.push('ランキング圏外');else xs.push(`売買代金${x.rank}位`);if(x.presence<=1)xs.push('継続性が低い');if(['D','E'].includes(x.analysis.entry_lane))xs.push(`${x.analysis.entry_lane}判定`);if(finite(x.analysis.rs20)&&x.analysis.rs20<0)xs.push(`RS20 ${round(x.analysis.rs20,1)}%`);return xs.slice(0,4).join(' / ')||'相対優位性が低下';}
export function buildRotationProposal({market,stocklist,stageRows=[],ranking,rankingHistory,candidates=[],protectedSymbols=[],config=DEFAULT_CONFIG,targetCount}={}){
  const m=market==='us'?'us':'jp',protectedSet=new Set(protectedSymbols),stageMap=new Map((stageRows||[]).map(x=>[x.symbol,x]));
  const historyDays=(rankingHistory?.snapshots||[]).length,limit=Math.min(10,historyDays||10),target=Math.max(1,Number(targetCount)||stocklist.length);
  const current=(stocklist||[]).map((item,index)=>{const a=stageMap.get(item.symbol)||{},rank=latestRank(ranking,item.symbol),presence=persistence(rankingHistory,item.symbol,limit),score=scoreUniverseItem({item,analysis:a,rank,presence,market:m});return{...item,index,tier:tierFor(m,index),theme:themeName(item.symbol,a.theme),rank,presence,score,analysis:compactAnalysis(a),protected_reason:protectedReason(item,protectedSet)};});
  const registered=new Set(current.map(x=>x.symbol));
  const candidateRows=(candidates||[]).filter(x=>x?.symbol&&!registered.has(x.symbol)).map(x=>{const rank=x.rank??latestRank(ranking,x.symbol),presence=persistence(rankingHistory,x.symbol,limit),analysis=compactAnalysis(x),score=scoreUniverseItem({item:x,analysis:{...x,...analysis},rank,presence,market:m,candidate:true});return{symbol:x.symbol,name:x.name||x.symbol,market:m,theme:themeName(x.symbol,x.theme),rank,presence,score,analysis,reason:proposalReasonCandidate({rank,presence,analysis})};}).filter(x=>x.score>=Number(config.candidate_min_score||58)).sort((a,b)=>b.score-a.score);
  const counts=new Map();for(const x of current)counts.set(x.theme,(counts.get(x.theme)||0)+1);
  const removable=current.filter(x=>!x.protected_reason).filter(x=>m==='jp'?(current.length<=LIMITS.jpCore||x.tier==='radar'):true).filter(x=>{
    const floor=Math.max(1,Number(config.theme_minimum||2));if((counts.get(x.theme)||0)<=floor)return false;
    const weakLane=['D','E'].includes(x.analysis.entry_lane)||!x.analysis.entry_lane;
    const weakRank=!x.rank||x.rank>(m==='jp'?200:80);
    return weakLane&&weakRank&&x.presence<=Math.max(2,Math.floor(limit/3));
  }).sort((a,b)=>a.score-b.score);
  const addSlots=Math.max(0,target-current.length),adds=[],drops=[],usedDrop=new Set(),themeDropCount=new Map();
  for(const c of candidateRows){
    if(adds.length>=Math.max(addSlots,Number(config.weekly_swap_limit||2)))break;
    if(adds.length<addSlots){adds.push({...c,action:'add',replacement:null});continue;}
    const floor=Math.max(1,Number(config.theme_minimum||2));
    const d=removable.find(x=>{if(usedDrop.has(x.symbol)||c.score-x.score<Number(config.score_advantage||18))return false;const used=themeDropCount.get(x.theme)||0,after=(counts.get(x.theme)||0)-used-1+(c.theme===x.theme?1:0);return after>=floor;});if(!d)continue;
    usedDrop.add(d.symbol);themeDropCount.set(d.theme,(themeDropCount.get(d.theme)||0)+1);drops.push({...d,action:m==='us'?'demote':'remove',reason:proposalReasonDrop(d)});adds.push({...c,action:'replace',replacement:d.symbol});
  }
  const canApply=historyDays>=Number(config.min_history_days||7)&&Boolean(adds.length)&&(config.mode!=='off');
  return{market:m,generated_at:nowIso(),history_days:historyDays,target_count:target,current_count:current.length,active_count:m==='jp'?Math.min(current.length,LIMITS.jpMax):Math.min(current.length,LIMITS.usLead),protected_count:current.filter(x=>x.protected_reason).length,can_apply:canApply,blocked_reason:historyDays<Number(config.min_history_days||7)?`ランキング履歴${config.min_history_days}日未満`:adds.length?'': '入れ替え条件を満たす候補なし',adds,drops,current,candidate_count:candidateRows.length};
}
async function readConfig(env){return{...DEFAULT_CONFIG,...parseJson(await env.COCKPIT_KV.get(KEYS.universeConfig),{})};}
async function readState(env){return parseJson(await env.COCKPIT_KV.get(KEYS.universeState),{proposal:null,history:[],last_auto_at:null});}
async function protectedSymbols(env){const [watch,discipline]=await Promise.all([env.COCKPIT_KV.get(KEYS.watch).then(x=>parseJson(x,[])),env.COCKPIT_KV.get(KEYS.discipline).then(x=>parseJson(x,{}))]);return new Set([...(watch||[]).map(x=>x.symbol),...((discipline?.positions)||[]).map(x=>x.symbol)]);}
async function rankingHistory(env,market){return parseJson(await env.COCKPIT_KV.get(KEYS.rankingHistory(market)),{snapshots:[]});}
async function marketProposal(env,market,config,protectedSet){
  const [stocklist,ranking,hist,stageRaw]=await Promise.all([getStockList(env,market),getRanking(env,market,false),rankingHistory(env,market),env.COCKPIT_KV.get(KEYS.stage(market)).then(x=>parseJson(x,{stocks:{}}))]);
  let source;if(market==='jp'){const ex=await getExplorer(env,'jp',false);source=[...(ex.items||[]),...(ex.skipped||[])];}else{const er=await getEnrichedRanking(env,'us',false);source=er.items||[];}
  const target=market==='jp'?Math.max(Math.min(stocklist.length||LIMITS.jpCore,LIMITS.jpMax),Math.min(LIMITS.jpCore,stocklist.length||LIMITS.jpCore)):Number(config.us_lead_target||LIMITS.usLead);
  return buildRotationProposal({market,stocklist,stageRows:Object.values(stageRaw.stocks||{}),ranking,rankingHistory:hist,candidates:source,protectedSymbols:[...protectedSet],config,targetCount:target});
}
export async function refreshUniverseProposal(env,{source='manual'}={}){
  const [config,state,protectedSet]=await Promise.all([readConfig(env),readState(env),protectedSymbols(env)]),[jp,us]=await Promise.all([marketProposal(env,'jp',config,protectedSet),marketProposal(env,'us',config,protectedSet)]);
  const proposal={generated_at:nowIso(),source,jp,us,coverage:buildThemeCoverage(jp.current,us.current)};const next={...state,proposal};await env.COCKPIT_KV.put(KEYS.universeState,JSON.stringify(next));return{ok:true,config,proposal,history:(state.history||[]).slice(-20),last_auto_at:state.last_auto_at||null};
}
function isSameWeek(a,b){if(!a||!b)return false;const da=new Date(a),db=new Date(b);const monday=d=>{const x=new Date(d);const day=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-day);return x.toISOString().slice(0,10);};return monday(da)===monday(db);}
function applyMarket(list,proposal,market){
  const m=market==='us'?'us':'jp',drops=new Set((proposal.drops||[]).map(x=>x.symbol)),adds=proposal.adds||[];
  let next=list.map(x=>({...x}));
  if(m==='jp')next=next.filter(x=>!drops.has(x.symbol));
  else{for(const sym of drops){const i=next.findIndex(x=>x.symbol===sym);if(i>=0){const [it]=next.splice(i,1);next.splice(Math.min(LIMITS.usLead,next.length),0,it);}}}
  for(const a of adds){if(next.some(x=>x.symbol===a.symbol))continue;const item={symbol:a.symbol,name:a.name,added_at:nowIso(),source:'auto_rotation',auto_added_at:nowIso(),pinned:false};if(m==='jp')next.push(item);else next.splice(Math.min(LIMITS.usLead-1,next.length),0,item);}
  const max=m==='jp'?LIMITS.jpMax:LIMITS.usMax;return next.slice(0,max);
}
export async function applyUniverseProposal(env,{source='manual',force=false}={}){
  const [config,state]=await Promise.all([readConfig(env),readState(env)]);let proposal=state.proposal;if(!proposal)proposal=(await refreshUniverseProposal(env,{source})).proposal;
  if(config.mode==='off'&&!force)return{ok:false,error:'自動入れ替えは停止中'};
  const applied=[];for(const market of ['jp','us']){const p=proposal[market];if(!p?.can_apply&&!force)continue;const current=await getStockList(env,market),next=applyMarket(current,p,market);if(JSON.stringify(current.map(x=>x.symbol))===JSON.stringify(next.map(x=>x.symbol)))continue;await saveStockList(env,market,next);applied.push({market,adds:p.adds,drops:p.drops,before:current.length,after:next.length});}
  const record={id:`u${Date.now()}`,at:nowIso(),source,applied};const nextState={...state,last_auto_at:source==='scheduled'&&applied.length?record.at:state.last_auto_at,history:[...(state.history||[]),record].slice(-60),proposal:null};await env.COCKPIT_KV.put(KEYS.universeState,JSON.stringify(nextState));return{ok:true,applied,record};
}
export async function maybeAutoRotateUniverse(env,source='scheduled'){
  const [config,state]=await Promise.all([readConfig(env),readState(env)]);const report=await refreshUniverseProposal(env,{source});if(config.mode!=='guarded_auto')return{...report,auto_applied:false};if(isSameWeek(state.last_auto_at,nowIso()))return{...report,auto_applied:false,reason:'今週分は適用済み'};const enough=['jp','us'].some(m=>report.proposal[m]?.can_apply);if(!enough)return{...report,auto_applied:false,reason:'適用条件なし'};const result=await applyUniverseProposal(env,{source});return{...report,auto_applied:Boolean(result.applied?.length),result};
}
export async function getUniverseDashboard(env){const [config,state,jp,us]=await Promise.all([readConfig(env),readState(env),getStockList(env,'jp'),getStockList(env,'us')]);return{ok:true,config,proposal:state.proposal,history:(state.history||[]).slice(-20).reverse(),last_auto_at:state.last_auto_at||null,coverage:buildThemeCoverage(jp,us),counts:{jp:{registered:jp.length,core:Math.min(jp.length,LIMITS.jpCore),radar:Math.max(0,jp.length-LIMITS.jpCore),max:LIMITS.jpMax},us:{registered:us.length,lead:Math.min(us.length,LIMITS.usLead),archive:Math.max(0,us.length-LIMITS.usLead),max:LIMITS.usMax}}};}
export async function mutateUniverse(env,body={}){const action=body.action||'get';if(action==='refresh')return refreshUniverseProposal(env,{source:'manual'});if(action==='apply')return applyUniverseProposal(env,{source:'manual',force:Boolean(body.force)});if(action==='config'){const current=await readConfig(env),next={...current};if(['off','proposal','guarded_auto'].includes(body.mode))next.mode=body.mode;if(body.weekly_swap_limit!=null)next.weekly_swap_limit=Math.max(1,Math.min(5,Number(body.weekly_swap_limit)||2));if(body.theme_minimum!=null)next.theme_minimum=Math.max(1,Math.min(4,Number(body.theme_minimum)||2));await env.COCKPIT_KV.put(KEYS.universeConfig,JSON.stringify(next));return{ok:true,config:next};}return{ok:false,error:'unknown action'};}
export { DEFAULT_CONFIG, IMPORTANT_THEMES };

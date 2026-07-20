import { corsHeaders, json, authorized } from './api/http.js';
import { route } from './api/routes.js';
import { ensureSchema, KEYS } from './storage/kv-schema.js';
import { migrateLegacyData } from './storage/migration.js';
import { scheduleSnapshotOptions, marketParts, runStageBatch, getStage, refreshMacroSnapshots } from './services/stage.js';
import { getEnrichedRanking, buildExplorer } from './services/ranking.js';
import { captureSignalLog } from './services/signal-log.js';
import { runBacktestStep } from './services/backtest.js';
import { evaluateIndexTriggers, sendPushToAll } from './services/push.js';
import { isTradingDay, isUsDst } from './data/calendar.js';
import { jstDate } from './utils.js';
import { KV_SCHEMA_VERSION } from './config.js';
import { captureThemeSnapshot } from './services/theme-history.js';
import { maybeAutoRotateUniverse } from './services/universe-manager.js';
import { getMarginDataset } from './services/margin-supply.js';


async function initializeStorage(env){
  const current=await env.COCKPIT_KV.get(KEYS.schema);
  if(current!==KV_SCHEMA_VERSION)await migrateLegacyData(env);
  return ensureSchema(env,current);
}
async function snapshotReady(env,node){const s=await getStage(env,node.market),expected=scheduleSnapshotOptions(node.market,node.key.split(':')[0],node.kind,node.tradeDate).snapshotId;return s.complete&&s.snapshot_id===expected&&(node.kind!=='confirmed'||(s.kind==='confirmed'&&Number(s.close_verification?.ratio||0)>=90));}
async function currentCloseReady(env,market,tradeDate){const s=await getStage(env,market);return s.complete&&s.trade_date===tradeDate&&s.kind==='confirmed'&&Number(s.close_verification?.ratio||0)>=90;}
async function pushIndex(env){const triggers=await evaluateIndexTriggers(env);for(const t of triggers||[]){const key=`sched:push:${t.key}:${jstDate()}`;if(await env.COCKPIT_KV.get(key))continue;await sendPushToAll(env,{title:t.title,body:t.body,url:'./'});await env.COCKPIT_KV.put(key,String(Date.now()),{expirationTtl:72000});}}
function scheduleNodes(now=new Date()){
  const jst=new Date(now.getTime()+9*3600000),minute=jst.getUTCHours()*60+jst.getUTCMinutes(),date=jst.toISOString().slice(0,10),nodes=[];
  const add=(market,label,at,kind,tradeDate,parts,action='stage')=>{if(action==='stage'){for(let p=1;p<=parts;p++)nodes.push({key:`${label}:b${p}`,at,market,kind,tradeDate,parts,part:p});nodes.push({key:`${label}:enrich`,at,market,kind,tradeDate,parts,action:'enrich'});}else nodes.push({key:label,at,market,kind,tradeDate,parts,action});};
  const day=jst.getUTCDay(),addMacro=(label,at)=>nodes.push({key:label,at,market:'macro',kind:'live',tradeDate:date,parts:1,action:'macro'});
  // Macro observations have their own exchange calendars. Run them independently
  // from JP/US stock-stage jobs so a Japanese holiday does not freeze KOSPI,
  // FX, volatility or futures. Early Saturday JST captures Friday's US close.
  if(day>=1&&day<=5){addMacro('macro_0910',550);addMacro('macro_1210',730);addMacro('macro_1610',970);addMacro('macro_1810',1090);addMacro('macro_2350',1430);}
  if(day>=1&&day<=6)addMacro('macro_0635',395);
  const jpDate=date,jpObj=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate()));
  if(isTradingDay('jp',jpObj)){
    add('jp','jp_0930',570,'intraday',jpDate,4);add('jp','jp_1020',620,'intraday',jpDate,4);add('jp','jp_1200',720,'intraday',jpDate,marketParts('jp'));add('jp','jp_1420',860,'intraday',jpDate,4);add('jp','jp_1520',920,'intraday',jpDate,4);add('jp','jp_1610',970,'confirmed',jpDate,marketParts('jp'));add('jp','jp_1700_retry',1020,'confirmed',jpDate,marketParts('jp'));add('jp','jp_1305_explorer',785,'intraday',jpDate,1,'explorer');add('jp','jp_1755_explorer',1075,'confirmed',jpDate,1,'explorer');add('jp','jp_1820_universe',1100,'confirmed',jpDate,1,'universe');add('jp','jp_1910_margin',1150,'confirmed',jpDate,1,'margin');
  }
  const usObj=minute<720?new Date(jpObj.getTime()-86400000):jpObj,usDate=usObj.toISOString().slice(0,10);if(isTradingDay('us',usObj)){if(isUsDst(now)){add('us','us_2240',1360,'intraday',usDate,marketParts('us'));add('us','us_0520',320,'confirmed',usDate,marketParts('us'));add('us','us_0605_retry',365,'confirmed',usDate,marketParts('us'));}else{add('us','us_2340',1420,'intraday',usDate,marketParts('us'));add('us','us_0620',380,'confirmed',usDate,marketParts('us'));add('us','us_0705_retry',425,'confirmed',usDate,marketParts('us'));}}
  return{minute,nodes};
}
async function scheduledStage(env){const{minute,nodes}=scheduleNodes();for(const n of nodes){if(minute<n.at||minute>=n.at+55)continue;const marker=`sched:v50:${n.key}:${n.tradeDate}`;if(await env.COCKPIT_KV.get(marker))continue;
    try{
      if(n.action==='macro')await refreshMacroSnapshots(env);
      else if(n.action==='explorer')await buildExplorer(env,'jp',true);
      else if(n.action==='universe')await maybeAutoRotateUniverse(env,'scheduled');
      else if(n.action==='margin')await getMarginDataset(env,{force:true});
      else if(n.action==='enrich'){
        const retry=n.key.includes('_retry'),ready=retry?await currentCloseReady(env,n.market,n.tradeDate):await snapshotReady(env,n);
        if(!ready)throw new Error(`${n.market} snapshot not ready for enrich`);
        await getEnrichedRanking(env,n.market,true);if(n.kind==='confirmed'){await captureSignalLog(env,n.market,'auto');await captureThemeSnapshot(env,'scheduled');}
      }else{
        if(n.key.includes('_retry')&&await currentCloseReady(env,n.market,n.tradeDate)){/* skip already complete */}
        else{const opt=scheduleSnapshotOptions(n.market,n.key.split(':')[0],n.kind,n.tradeDate);opt.parts=n.parts;await runStageBatch(env,`${n.market}${n.part}`,opt);}
      }
      await env.COCKPIT_KV.put(marker,String(Date.now()),{expirationTtl:129600});
    }catch(e){console.error('[scheduled]',n.key,e?.stack||e);}break;
  }}
export default{
  async fetch(request,env){if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(request)});if(!authorized(request,env))return json({ok:false,error:'write access denied'},403,request);try{await initializeStorage(env);return await route(request,env);}catch(e){console.error('[fetch]',e?.stack||e);return json({ok:false,error:e?.message||String(e)},500,request);}},
  async scheduled(event,env,ctx){ctx.waitUntil((async()=>{try{await initializeStorage(env);await scheduledStage(env);}catch(e){console.error('[stage cron]',e?.stack||e);}try{await pushIndex(env);}catch(e){console.error('[push cron]',e?.stack||e);}try{await runBacktestStep(env,1,false);}catch(e){console.error('[backtest cron]',e?.stack||e);}})());}
};

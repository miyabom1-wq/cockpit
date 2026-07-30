import { corsHeaders, json, authorized } from './api/http.js';
import { route } from './api/routes.js';
import { ensureSchema, KEYS } from './storage/kv-schema.js';
import { migrateLegacyData } from './storage/migration.js';
import {
  scheduleSnapshotOptions,
  marketParts,
  registeredMarketParts,
  runStageBatch,
  getStage,
  refreshMacroSnapshots
} from './services/stage.js';
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
import {
  recordCronHeartbeat,
  recordSchedulerSuccess,
  recordSchedulerRetry,
  recordSchedulerFailure
} from './services/system-health.js';

const SCHEDULER_MARKER_VERSION='v70';
const RETRY_COOLDOWN_SECONDS=600;

async function initializeStorage(env){
  const current=await env.COCKPIT_KV.get(KEYS.schema);
  if(current!==KV_SCHEMA_VERSION)await migrateLegacyData(env);
  return ensureSchema(env,current);
}

async function snapshotReady(env,node){
  const s=await getStage(env,node.market);
  const expected=scheduleSnapshotOptions(node.market,node.key.split(':')[0],node.kind,node.tradeDate).snapshotId;
  return s.complete&&s.snapshot_id===expected&&(
    node.kind!=='confirmed'||(s.kind==='confirmed'&&Number(s.close_verification?.ratio||0)>=90)
  );
}

async function currentCloseReady(env,market,tradeDate){
  const s=await getStage(env,market);
  return s.complete&&s.trade_date===tradeDate&&s.kind==='confirmed'&&Number(s.close_verification?.ratio||0)>=90;
}

async function pushIndex(env){
  const triggers=await evaluateIndexTriggers(env);
  for(const t of triggers||[]){
    const key=`sched:push:${t.key}:${jstDate()}`;
    if(await env.COCKPIT_KV.get(key))continue;
    await sendPushToAll(env,{title:t.title,body:t.body,url:'./'});
    await env.COCKPIT_KV.put(key,String(Date.now()),{expirationTtl:72000});
  }
}

export function scheduleNodes(now=new Date()){
  const jst=new Date(now.getTime()+9*3600000);
  const minute=jst.getUTCHours()*60+jst.getUTCMinutes();
  const date=jst.toISOString().slice(0,10);
  const nodes=[];

  const add=(market,label,at,kind,tradeDate,parts,action='stage',guard={})=>{
    const base={at,market,kind,tradeDate,parts,window:55,...guard};
    if(action==='stage'){
      for(let p=1;p<=parts;p++)nodes.push({key:`${label}:b${p}`,...base,part:p,action:'stage'});
      nodes.push({key:`${label}:enrich`,...base,action:'enrich'});
    }else{
      nodes.push({key:label,...base,action});
    }
  };

  const day=jst.getUTCDay();
  const addMacro=(label,at)=>nodes.push({
    key:label,at,market:'macro',kind:'live',tradeDate:date,parts:1,action:'macro',window:55
  });

  if(day>=1&&day<=5){
    addMacro('macro_0910',550);
    addMacro('macro_1220',740);
    addMacro('macro_1630',990);
    addMacro('macro_1810',1090);
    addMacro('macro_2350',1430);
  }
  if(day>=1&&day<=6)addMacro('macro_0635',395);

  const jpDate=date;
  const jpObj=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate()));
  if(isTradingDay('jp',jpObj)){
    add('jp','jp_0930',570,'intraday',jpDate,4);
    add('jp','jp_1020',620,'intraday',jpDate,4);
    add('jp','jp_1130',690,'intraday',jpDate,marketParts('jp'),'stage',{minSessionRatio:80});
    add('jp','jp_1420',860,'intraday',jpDate,4);
    add('jp','jp_1505',905,'intraday',jpDate,4);
    add('jp','jp_1535',935,'confirmed',jpDate,marketParts('jp'),'stage',{minConfirmedRatio:90});
    add('jp','jp_1640_retry',1000,'confirmed',jpDate,marketParts('jp'),'stage',{minConfirmedRatio:90});
    add('jp','jp_1735_retry2',1055,'confirmed',jpDate,marketParts('jp'),'stage',{minConfirmedRatio:90});
    add('jp','jp_1800_recovery',1080,'confirmed',jpDate,marketParts('jp'),'stage',{minConfirmedRatio:90,window:360});
    add('jp','jp_1305_explorer',785,'intraday',jpDate,1,'explorer');
    add('jp','jp_1755_explorer',1075,'confirmed',jpDate,1,'explorer');
    add('jp','jp_1820_universe',1100,'confirmed',jpDate,1,'universe');
    add('jp','jp_1910_margin',1150,'confirmed',jpDate,1,'margin');
  }

  const usObj=minute<720?new Date(jpObj.getTime()-86400000):jpObj;
  const usDate=usObj.toISOString().slice(0,10);
  if(isTradingDay('us',usObj)){
    if(isUsDst(now)){
      add('us','us_2230',1350,'intraday',usDate,marketParts('us'),'stage',{minSessionRatio:80});
      add('us','us_0505',305,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90});
      add('us','us_0540_retry',340,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90});
      add('us','us_0600_recovery',360,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90,window:360});
    }else{
      add('us','us_2330',1410,'intraday',usDate,marketParts('us'),'stage',{minSessionRatio:80});
      add('us','us_0605',365,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90});
      add('us','us_0640_retry',400,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90});
      add('us','us_0700_recovery',420,'confirmed',usDate,marketParts('us'),'stage',{minConfirmedRatio:90,window:300});
    }
    if(minute<240)add('us','us_0000_live_recovery',0,'intraday',usDate,marketParts('us'),'stage',{minSessionRatio:80,window:240});
  }

  if(minute<480){
    const previousJp=new Date(jpObj.getTime()-86400000);
    if(isTradingDay('jp',previousJp)){
      const previousDate=previousJp.toISOString().slice(0,10);
      add('jp','jp_overnight_recovery',0,'confirmed',previousDate,marketParts('jp'),'stage',{minConfirmedRatio:90,window:480});
    }
  }

  return{minute,nodes};
}

function eligible(minute,node){
  const window=Math.max(1,Number(node.window||55));
  return minute>=node.at&&minute<Math.min(1440,node.at+window);
}

function nodePriority(node){
  if(node.key.startsWith('us_0000_live_recovery')&&node.action==='stage')return 0;
  if(node.action==='stage'&&node.kind==='confirmed'&&!node.key.includes('recovery'))return 0;
  if(node.action==='stage')return 1;
  if(node.action==='enrich')return 2;
  if(node.action==='macro')return 3;
  return 4;
}

function markerKey(node){
  return`sched:${SCHEDULER_MARKER_VERSION}:${node.key}:${node.tradeDate}`;
}

function cooldownKey(node){
  return`sched:cooldown:${SCHEDULER_MARKER_VERSION}:${node.key}:${node.tradeDate}`;
}

async function markDone(env,node,details={}){
  await env.COCKPIT_KV.put(markerKey(node),JSON.stringify({at:Date.now(),...details}),{expirationTtl:172800});
  await recordSchedulerSuccess(env,node,details);
}

export async function scheduledStage(env,now=new Date()){
  const {minute,nodes}=scheduleNodes(now);
  await recordCronHeartbeat(env,{minute,eligible:nodes.filter(n=>eligible(minute,n)).length});

  const runtimeParts={};
  const ordered=[...nodes].sort((a,b)=>nodePriority(a)-nodePriority(b)||a.at-b.at||a.key.localeCompare(b.key));
  for(const sourceNode of ordered){
    if(!eligible(minute,sourceNode))continue;
    const node={...sourceNode};

    if(['jp','us'].includes(node.market)&&(node.action==='stage'||node.action==='enrich')){
      runtimeParts[node.market]??=await registeredMarketParts(env,node.market);
      node.parts=runtimeParts[node.market];
      if(node.action==='stage'&&Number(node.part)>Number(node.parts))continue;
    }

    if(await env.COCKPIT_KV.get(markerKey(node)))continue;
    if(await env.COCKPIT_KV.get(cooldownKey(node)))continue;

    try{
      if(node.action==='macro'){
        const result=await refreshMacroSnapshots(env);
        await markDone(env,node,result);
        return{processed:1,node:node.key};
      }

      if(node.action==='explorer'){
        const result=await buildExplorer(env,'jp',true);
        await markDone(env,node,{ok:true,count:result?.items?.length||0});
        return{processed:1,node:node.key};
      }

      if(node.action==='universe'){
        const result=await maybeAutoRotateUniverse(env,'scheduled');
        await markDone(env,node,{ok:true,changed:Boolean(result?.changed)});
        return{processed:1,node:node.key};
      }

      if(node.action==='margin'){
        const result=await getMarginDataset(env,{force:true});
        await markDone(env,node,{ok:true,as_of:result?.as_of||null});
        return{processed:1,node:node.key};
      }

      if(node.action==='enrich'){
        const ready=node.kind==='confirmed'
          ?await currentCloseReady(env,node.market,node.tradeDate)
          :await snapshotReady(env,node);
        if(!ready){
          await env.COCKPIT_KV.put(cooldownKey(node),'not-ready',{expirationTtl:RETRY_COOLDOWN_SECONDS});
          await recordSchedulerRetry(env,node,{error:`${node.market} snapshot not ready for enrich`});
          return{processed:0,retry:true,node:node.key};
        }

        await getEnrichedRanking(env,node.market,true);
        if(node.kind==='confirmed'){
          await captureSignalLog(env,node.market,'auto');
          await captureThemeSnapshot(env,'scheduled');
        }
        await markDone(env,node,{ok:true,action:'enrich'});
        return{processed:1,node:node.key};
      }

      if(node.kind==='confirmed'&&await currentCloseReady(env,node.market,node.tradeDate)){
        await markDone(env,node,{ok:true,skipped:'already-complete'});
        continue;
      }

      const opt=scheduleSnapshotOptions(node.market,node.key.split(':')[0],node.kind,node.tradeDate);
      opt.parts=node.parts;
      if(node.minSessionRatio)opt.minSessionRatio=node.minSessionRatio;
      if(node.minConfirmedRatio)opt.minConfirmedRatio=node.minConfirmedRatio;

      const result=await runStageBatch(env,`${node.market}${node.part}`,opt);
      if(result?.committed&&result?.kind==='confirmed'){
        await captureSignalLog(env,result.market,'auto-stage');
      }

      if(result?.retry_required){
        await env.COCKPIT_KV.put(cooldownKey(node),JSON.stringify(result),{expirationTtl:RETRY_COOLDOWN_SECONDS});
        await recordSchedulerRetry(env,node,{
          error:result.reason||'freshness retry required',
          batch_freshness:result.batch_freshness,
          global_freshness:result.global_freshness,
          stale_parts:result.stale_parts,
        });
        return{processed:0,retry:true,node:node.key,result};
      }

      await markDone(env,node,{
        ok:true,
        action:'stage',
        part:result.part,
        parts:result.parts,
        committed:result.committed,
        batch_freshness:result.batch_freshness,
      });
      return{processed:1,node:node.key,result};
    }catch(error){
      console.error('[scheduled]',node.key,error?.stack||error);
      await env.COCKPIT_KV.put(cooldownKey(node),error?.message||String(error),{expirationTtl:RETRY_COOLDOWN_SECONDS});
      await recordSchedulerFailure(env,node,error);
      return{processed:0,error:error?.message||String(error),node:node.key};
    }
  }

  return{processed:0,node:null};
}

export default{
  async fetch(request,env){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(request)});
    if(!authorized(request,env))return json({ok:false,error:'write access denied'},403,request);
    try{
      await initializeStorage(env);
      return await route(request,env);
    }catch(error){
      console.error('[fetch]',error?.stack||error);
      return json({ok:false,error:error?.message||String(error)},500,request);
    }
  },

  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      try{
        await initializeStorage(env);
        await scheduledStage(env);
      }catch(error){
        console.error('[stage cron]',error?.stack||error);
      }
      try{await pushIndex(env)}catch(error){console.error('[push cron]',error?.stack||error)}
      try{await runBacktestStep(env,1,false)}catch(error){console.error('[backtest cron]',error?.stack||error)}
    })());
  }
};

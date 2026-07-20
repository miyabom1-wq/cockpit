import { APP_VERSION, BUILD_ID, KV_SCHEMA_VERSION, ENGINE_VERSION, BACKTEST_VERSION, DEPLOYED_AT } from '../config.js';
import { json } from './http.js';
import { ensureSchema } from '../storage/kv-schema.js';
import { migrateLegacyData, exportUserData } from '../storage/migration.js';
import { handleStockListAction } from '../storage/stocklist.js';
import { lookupSymbol } from '../data/yahoo.js';
import { getEvents, mutateEvent } from '../services/events.js';
import { getPositions, mutatePosition } from '../services/positions.js';
import { getWatchlist, mutateWatchlist } from '../services/watchlist.js';
import { getStage, getMomentum, getNoTrade, getReentry, runStageBatch } from '../services/stage.js';
import { getSignalLog, mutateSignalLog, captureSignalLog } from '../services/signal-log.js';
import { getBacktestDashboard, getBacktestSymbol, runBacktestStep } from '../services/backtest.js';
import { getRanking, getEnrichedRanking, getExplorer } from '../services/ranking.js';
import { addSub, removeSub, sendPushToAll, VAPID_PUBLIC_KEY_RAW } from '../services/push.js';
import { getThemeHistory, captureThemeSnapshot } from '../services/theme-history.js';
import { getUniverseDashboard, mutateUniverse } from '../services/universe-manager.js';
import { getMarginDashboard, MARGIN_DATA_SCHEMA } from '../services/margin-supply.js';

export async function route(request,env){
  const url=new URL(request.url),p=url.pathname;
  if(p==='/api/health')return json({ok:true,version:APP_VERSION,build:BUILD_ID,schema:KV_SCHEMA_VERSION,engine:ENGINE_VERSION,backtest:BACKTEST_VERSION,deployed_at:DEPLOYED_AT,time:new Date().toISOString(),entrypoint:'src/index.js',cron:'*/5 * * * *',margin:MARGIN_DATA_SCHEMA},200,request);
  if(p==='/api/migrate')return json({ok:true,schema:await ensureSchema(env),migration:await migrateLegacyData(env)},200,request);
  if(p==='/api/export')return json(await exportUserData(env),200,request);
  if(p==='/api/events')return request.method==='GET'?json({events:await getEvents(env,Date.now(),url.searchParams.get('refresh')==='1')},200,request):json(await mutateEvent(env,await request.json()),200,request);
  if(p==='/api/lookup'){const symbol=url.searchParams.get('symbol');if(!symbol)return json({ok:false,error:'symbol required'},400,request);const q=await lookupSymbol(symbol);return q?json(q,200,request):json({ok:false,error:'not found'},404,request);}
  if(p==='/api/positions')return request.method==='GET'?json(await getPositions(env),200,request):json(await mutatePosition(env,await request.json()),200,request);
  if(p==='/api/discipline-state')return request.method==='GET'?json((await getPositions(env)).state,200,request):json(await mutatePosition(env,await request.json()),200,request);
  if(p==='/api/watchlist')return request.method==='GET'?json(await getWatchlist(env),200,request):json(await mutateWatchlist(env,await request.json()),200,request);
  if(p==='/api/stage')return json(await getStage(env,url.searchParams.get('market')||'jp'),200,request);
  if(p==='/api/momentum')return json(await getMomentum(env,url.searchParams.get('market')||'jp'),200,request);
  if(p==='/api/notrade')return json(await getNoTrade(env,url.searchParams.get('market')||'jp'),200,request);
  if(p==='/api/reentry')return json(await getReentry(env,url.searchParams.get('market')||'jp'),200,request);
  if(p==='/api/stage-run')return json(await runStageBatch(env,url.searchParams.get('batch')),200,request);
  if(p==='/api/stocklist'){const market=url.searchParams.get('market')||'jp',body=request.method==='GET'?{action:'get'}:await request.json();return json(await handleStockListAction(env,market,body),200,request);}
  if(p==='/api/signal-log')return request.method==='GET'?json(await getSignalLog(env,url.searchParams.get('limit')),200,request):json(await mutateSignalLog(env,await request.json()),200,request);
  if(p==='/api/signal-log-capture')return json(await captureSignalLog(env,url.searchParams.get('market')||'jp','manual'),200,request);
  if(p==='/api/backtest')return json(await getBacktestDashboard(env),200,request);
  if(p==='/api/backtest-symbol')return json(await getBacktestSymbol(env,url.searchParams.get('market')||'jp',url.searchParams.get('symbol')),200,request);
  if(p==='/api/backtest-run')return json(await runBacktestStep(env,Math.max(1,Math.min(5,Number(url.searchParams.get('count')||1))),url.searchParams.get('force')==='1'),200,request);
  if(p==='/api/ranking')return json({ok:true,...await getRanking(env,url.searchParams.get('market')==='us'?'us':'jp',url.searchParams.get('refresh')==='1')},200,request);
  if(p==='/api/ranking-enriched')return json(await getEnrichedRanking(env,url.searchParams.get('market')==='us'?'us':'jp',url.searchParams.get('refresh')==='1'),200,request);
  if(p==='/api/explorer')return json(await getExplorer(env,url.searchParams.get('market')==='us'?'us':'jp',url.searchParams.get('refresh')==='1'),200,request);
  if(p==='/api/theme-history')return json(await getThemeHistory(env,url.searchParams.get('limit')),200,request);
  if(p==='/api/theme-history-capture')return json(await captureThemeSnapshot(env,'manual'),200,request);
  if(p==='/api/universe')return request.method==='GET'?json(await getUniverseDashboard(env),200,request):json(await mutateUniverse(env,await request.json()),200,request);
  if(p==='/api/margin-supply')return json(await getMarginDashboard(env,{force:url.searchParams.get('refresh')==='1'}),200,request);
  if(p==='/api/stage-suggest')return json({ok:true,new_candidates:[],drop_candidates:[],note:'探索タブへ統合'},200,request);
  if(p==='/api/push/key')return json({key:VAPID_PUBLIC_KEY_RAW},200,request);
  if(p==='/api/push/subscribe'){const body=await request.json();return json(await addSub(env,body.subscription||body),200,request);}
  if(p==='/api/push/unsubscribe'){const body=await request.json();return json(await removeSub(env,body.endpoint),200,request);}
  if(p==='/api/push/test')return json({ok:true,...await sendPushToAll(env,{title:'✅ VANTAGE 通知テスト',body:'通知は正常です',url:'./'})},200,request);
  return new Response('Not Found',{status:404});
}

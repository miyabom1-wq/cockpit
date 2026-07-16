import { KV_SCHEMA_VERSION } from '../config.js';
export const KEYS = Object.freeze({
  schema:'meta:schema',
  events:'events:list',
  discipline:'discipline:state',
  watch:'watchlist:v1',
  pushSubs:'push:subs',
  signalV5:'signal-log:v5',
  signalV3:'signal-log:v3',
  stocklist:market=>`stocklist:${market}`,
  stage:market=>`stage:${market}`,
  momentum:market=>`momentum:${market}`,
  noTrade:market=>`notrade:${market}`,
  ranking:market=>`ranking:${market}`,
  rankingHistory:market=>`ranking:history:${market}`,
  explorer:market=>`explorer:${market}`,
});
export async function ensureSchema(env,current=undefined){
  const raw=current===undefined?await env.COCKPIT_KV.get(KEYS.schema):current;
  if(raw===KV_SCHEMA_VERSION)return{ok:true,migrated:false,schema:KV_SCHEMA_VERSION};
  await env.COCKPIT_KV.put(KEYS.schema,KV_SCHEMA_VERSION);
  return{ok:true,migrated:true,from:raw||null,schema:KV_SCHEMA_VERSION};
}

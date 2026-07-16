import { KEYS } from './kv-schema.js';
import { parseJson, nowIso } from '../utils.js';
export async function migrateLegacyData(env){
  const report={at:nowIso(),copied:[],preserved:[],warnings:[]};
  for(const key of [KEYS.events,KEYS.discipline,KEYS.watch,KEYS.pushSubs,KEYS.stocklist('jp'),KEYS.stocklist('us')]){
    if(await env.COCKPIT_KV.get(key))report.preserved.push(key);
  }
  const v5=await env.COCKPIT_KV.get(KEYS.signalV5);
  if(!v5){
    const v3=await env.COCKPIT_KV.get(KEYS.signalV3);
    if(v3){
      const parsed=parseJson(v3,{items:[]});
      const payload={schema:'signal-v5',migrated_from:'signal-log:v3',migrated_at:nowIso(),items:Array.isArray(parsed)?parsed:(parsed.items||[])};
      await env.COCKPIT_KV.put(KEYS.signalV5,JSON.stringify(payload));report.copied.push(`${KEYS.signalV3}->${KEYS.signalV5}`);
    }
  }
  return report;
}
export async function exportUserData(env){
  const keys=[KEYS.events,KEYS.discipline,KEYS.watch,KEYS.pushSubs,KEYS.signalV5,KEYS.signalV3,KEYS.stocklist('jp'),KEYS.stocklist('us')];
  const out={exported_at:nowIso(),keys:{}};
  for(const k of keys){const v=await env.COCKPIT_KV.get(k);if(v!=null)out.keys[k]=v;}
  return out;
}

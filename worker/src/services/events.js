import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso } from '../utils.js';
export async function getEvents(env){const v=parseJson(await env.COCKPIT_KV.get(KEYS.events),[]);return Array.isArray(v)?v:[];}
async function save(env,list){await env.COCKPIT_KV.put(KEYS.events,JSON.stringify(list));}
export async function mutateEvent(env,body={}){
  const action=body.action||'get',list=await getEvents(env);
  if(action==='add'){
    const name=String(body.name||'').trim().slice(0,120),time=String(body.time||'');if(!name||!Number.isFinite(new Date(time).getTime()))throw new Error('イベント名と日時が必要です');
    const item={id:`e${Date.now()}${Math.random().toString(36).slice(2,6)}`,name,time,category:String(body.category||'other').slice(0,20),pinned:false,created_at:nowIso()};list.push(item);list.sort((a,b)=>new Date(a.time)-new Date(b.time));await save(env,list);return{ok:true,event:item};
  }
  if(action==='delete'){const next=list.filter(x=>x.id!==body.id);await save(env,next);return{ok:true,removed:list.length-next.length};}
  if(action==='toggle_pin'){const x=list.find(x=>x.id===body.id);if(x)x.pinned=!x.pinned;await save(env,list);return{ok:true,changed:x?1:0,pinned:x?.pinned};}
  if(action==='clear_completed'){const ids=new Set(Array.isArray(body.ids)?body.ids:[]),now=Date.now(),next=list.filter(x=>x.pinned||(!ids.size?new Date(x.time).getTime()>=now:!ids.has(x.id)));await save(env,next);return{ok:true,removed:list.length-next.length};}
  return{ok:false,error:'unknown action'};
}

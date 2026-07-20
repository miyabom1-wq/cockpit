import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso, normalizeSymbol } from '../utils.js';

const DAY=86400000;
const VERIFIED_EVENTS=Object.freeze([
  {id:'official-4063-20260724',name:'信越化学 2026年1Q決算',time:'2026-07-24T06:30:00.000Z',time_note:'7/24 15:30',category:'earnings',symbols:['4063.T'],source:'official',source_name:'信越化学 IR',read_only:true,pinned:true},
  {id:'official-stx-20260728',name:'Seagate FY2026 Q4・通期決算',time:'2026-07-28T20:00:00.000Z',time_note:'7/28 米国市場終了後',category:'earnings',symbols:['STX'],source:'official',source_name:'Seagate IR',read_only:true,pinned:true},
  {id:'official-2914-20260730',name:'JT 2026年2Q決算',time:'2026-07-30T06:30:00.000Z',time_note:'7/30 15:30',category:'earnings',symbols:['2914.T'],source:'official',source_name:'JT IR',read_only:true,pinned:true},
  {id:'official-7011-20260804',name:'三菱重工 2026年度1Q決算',time:'2026-08-04T04:30:00.000Z',time_note:'8/4 13:30',category:'earnings',symbols:['7011.T'],source:'official',source_name:'三菱重工 IR',read_only:true,pinned:true},
  {id:'official-lite-20260811',name:'Lumentum FY2026 Q4・通期決算',time:'2026-08-11T20:00:00.000Z',time_note:'8/11 米国市場終了後',category:'earnings',symbols:['LITE'],source:'official',source_name:'Lumentum IR',read_only:true,pinned:true}
]);

function normalizeSymbols(value){const xs=Array.isArray(value)?value:String(value||'').split(/[\s,、/]+/);return[...new Set(xs.map(x=>{const s=String(x||'').trim().toUpperCase();if(!s)return null;const jp=/\.T$/.test(s)||/^(?=.*\d)[0-9A-Z]{4}$/.test(s);return normalizeSymbol(s,jp?'jp':'us');}).filter(Boolean))].slice(0,20);}
function normalizeEvent(x={}){return{...x,symbols:normalizeSymbols(x.symbols||[]),source:x.source||'manual',read_only:!!x.read_only};}
function eventKey(x){return`${String(x.time||'').slice(0,10)}|${normalizeSymbols(x.symbols||[]).sort().join(',')}`;}
async function getManualEvents(env){const v=parseJson(await env.COCKPIT_KV.get(KEYS.events),[]);return(Array.isArray(v)?v:[]).map(normalizeEvent).filter(x=>x.source!=='official');}
export function officialEvents(now=Date.now()){return VERIFIED_EVENTS.filter(x=>Date.parse(x.time)>=now-DAY&&Date.parse(x.time)<=now+120*DAY).map(normalizeEvent);}
export async function getEvents(env,now=Date.now()){
  const manual=await getManualEvents(env),manualKeys=new Set(manual.map(eventKey)),verified=officialEvents(now).filter(x=>!manualKeys.has(eventKey(x)));
  return[...manual,...verified].sort((a,b)=>new Date(a.time)-new Date(b.time));
}
async function save(env,list){await env.COCKPIT_KV.put(KEYS.events,JSON.stringify(list));}
export async function mutateEvent(env,body={}){
  const action=body.action||'get',list=await getManualEvents(env);
  if(action==='add'){
    const name=String(body.name||'').trim().slice(0,120),time=String(body.time||'');if(!name||!Number.isFinite(new Date(time).getTime()))throw new Error('イベント名と日時が必要です');
    const item={id:`e${Date.now()}${Math.random().toString(36).slice(2,6)}`,name,time,category:String(body.category||'other').slice(0,20),symbols:normalizeSymbols(body.symbols),source:'manual',pinned:false,read_only:false,created_at:nowIso()};list.push(item);list.sort((a,b)=>new Date(a.time)-new Date(b.time));await save(env,list);return{ok:true,event:item};
  }
  if(action==='delete'){const next=list.filter(x=>x.id!==body.id);await save(env,next);return{ok:true,removed:list.length-next.length};}
  if(action==='toggle_pin'){const x=list.find(x=>x.id===body.id);if(x)x.pinned=!x.pinned;await save(env,list);return{ok:true,changed:x?1:0,pinned:x?.pinned};}
  if(action==='clear_completed'){const ids=new Set(Array.isArray(body.ids)?body.ids:[]),now=Date.now(),next=list.filter(x=>x.pinned||(!ids.size?new Date(x.time).getTime()>=now:!ids.has(x.id)));await save(env,next);return{ok:true,removed:list.length-next.length};}
  return{ok:false,error:'unknown action'};
}

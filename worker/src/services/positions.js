import { KEYS } from '../storage/kv-schema.js';
import { parseJson, nowIso, normalizeSymbol, finite, round } from '../utils.js';
const DEFAULT={positions:[],position_count:0,last_violation_at:null,cooldown_hours:48,note:''};
async function read(env){const x=parseJson(await env.COCKPIT_KV.get(KEYS.discipline),{});const s={...DEFAULT,...x};if(!Array.isArray(s.positions))s.positions=[];s.position_count=s.positions.length||s.position_count||0;return s;}
async function save(env,s){await env.COCKPIT_KV.put(KEYS.discipline,JSON.stringify(s));}
function cooldown(s){if(!s.last_violation_at)return{...s,cooldown_active:false,cooldown_remaining_h:0};const remain=(s.cooldown_hours||48)-(Date.now()-new Date(s.last_violation_at).getTime())/3600000;return{...s,cooldown_active:remain>0,cooldown_remaining_h:remain>0?round(remain,1):0};}
export async function getPositions(env){
  const s=await read(env),stages={jp:parseJson(await env.COCKPIT_KV.get(KEYS.stage('jp')),{stocks:{}}),us:parseJson(await env.COCKPIT_KV.get(KEYS.stage('us')),{stocks:{}})};
  const positions=s.positions.map(p=>{const a=stages[p.market||((p.symbol||'').endsWith('.T')?'jp':'us')]?.stocks?.[p.symbol]||{},price=finite(a.price)?Number(a.price):null;return{...p,current_price:price,change_pct:a.change_pct??null,entry_lane:a.entry_lane??null,long_stage:a.long_stage??null,pnl_pct:finite(price)&&finite(p.avg_price)?round((price/p.avg_price-1)*100):null,pnl:finite(price)&&finite(p.avg_price)&&finite(p.qty)?round((price-p.avg_price)*p.qty,0):null};});
  return{ok:true,positions,state:cooldown({...s,positions,position_count:positions.length})};
}
export async function mutatePosition(env,body={}){
  const s=await read(env),action=body.action||'set';
  if(action==='toggle_held'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market),i=s.positions.findIndex(x=>x.symbol===symbol);let held;
    if(i>=0){s.positions.splice(i,1);held=false;}else{s.positions.push({symbol,name:String(body.name||symbol).slice(0,80),market,avg_price:null,qty:null,opened_at:nowIso()});held=true;}s.position_count=s.positions.length;await save(env,s);return{ok:true,held,state:cooldown(s)};
  }
  if(action==='add_position'){
    const market=body.market==='us'?'us':'jp',symbol=normalizeSymbol(body.symbol,market),avg=Number(body.avg_price),qty=Number(body.qty);if(!symbol||!(avg>0)||!(qty>0))return{ok:false,error:'symbol・取得単価・数量が必要です'};
    const x=s.positions.find(x=>x.symbol===symbol);if(x){const total=Number(x.qty||0)+qty;x.avg_price=((Number(x.avg_price||0)*Number(x.qty||0)+avg*qty)/total);x.qty=total;}else s.positions.push({symbol,name:String(body.name||symbol).slice(0,80),market,avg_price:avg,qty,opened_at:nowIso()});
  }else if(action==='remove_position')s.positions=s.positions.filter(x=>x.symbol!==String(body.symbol||'').toUpperCase());
  else if(action==='record_violation')s.last_violation_at=nowIso();
  else if(action==='clear_violation')s.last_violation_at=null;
  else{if(body.note!=null)s.note=String(body.note).slice(0,200);if(body.cooldown_hours!=null)s.cooldown_hours=Math.max(0,Math.min(168,Number(body.cooldown_hours)||48));}
  s.position_count=s.positions.length;await save(env,s);return{ok:true,state:cooldown(s)};
}

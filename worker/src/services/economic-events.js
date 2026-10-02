// Only the rolling, normalized schedule is stored. Raw source documents and
// successful-check timestamps never enter KV, so an unchanged run does no put.
import { ECONOMIC_SEED } from './economic-seed.js';
export const ECONOMIC_KEY='events:economic:v1';
export const ECONOMIC_CRON='17 20 * * *'; // 05:17 JST; separate from the market cron.
export const WINDOW_DAYS=120;
export const MAX_BYTES=32768;
const DAY=86400000;
export const SOURCES=Object.freeze({
  bls:'https://www.bls.gov/schedule/news_release/bls.ics',
  bea:'https://apps.bea.gov/API/signup/release_dates.json',
  fed:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  boj:'https://www.boj.or.jp/en/mopo/mpmsche_minu/',
  jp:'https://www.stat.go.jp/data/kouhyou/e-stat_cpi.xml',
  ecb:'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'
});
const TYPES={
  cpi:['米国 CPI・コアCPI','us',3,'bls'],
  nfp:['米国 雇用統計（NFP・失業率・賃金）','us',3,'bls'],
  pce:['米国 PCE・コアPCE','us',3,'bea'],
  gdp:['米国 GDP','us',3,'bea'],
  fomc:['FOMC 政策金利','us',3,'fed'],
  fomc_sep:['FOMC 政策金利・SEP','us',3,'fed'],
  fed_press:['FOMC 議長会見','us',3,'fed'],
  boj:['日銀 金融政策決定会合','jp',3,'boj'],
  jp_cpi:['日本 CPI（全国）','jp',2,'jp'],
  ecb:['ECB 政策金利','eu',2,'ecb'],
  ecb_press:['ECB 総裁会見','eu',2,'ecb']
};
const SOURCE_NAMES={bls:'米労働統計局 BLS',bea:'米経済分析局 BEA',fed:'FRB',boj:'日本銀行',jp:'総務省「消費者物価指数」',ecb:'欧州中央銀行 ECB'};
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const pad=n=>String(n).padStart(2,'0');
const date=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const month=s=>months.indexOf(s.trim().slice(0,3).toLowerCase())+1;
const formats=Object.fromEntries(['America/New_York','Europe/Berlin','Asia/Tokyo'].map(timeZone=>[timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})]));

// Intl handles US and European DST independently, including cross-year windows.
export function zonedTime(day,clock,zone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(clock))throw Error('Invalid local date/time');
  const target=Date.parse(`${day}T${clock}:00Z`);
  if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,16)!==`${day}T${clock}`)throw Error('Invalid local date/time');
  const format=formats[zone];if(!format)throw Error('Unsupported timezone');
  let value=target;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(format.formatToParts(value).map(x=>[x.type,x.value]));
    const shown=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta=target-shown;if(!delta)return new Date(value).toISOString();value+=delta;
  }
  throw Error('Ambiguous local date/time');
}
// Rows: [type, UTC ISO or date-only JST]. Names/importance/URLs live in code.
export function parseBls(ics){
  if(!ics.includes('BEGIN:VCALENDAR'))throw Error('BLS calendar invalid');
  const out=[];
  for(const match of ics.replace(/\r?\n[ \t]/g,'').matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)){
    const block=match[1];if(/STATUS:CANCELLED/.test(block))continue;
    const name=block.match(/(?:^|\n)SUMMARY:(.*)/)?.[1]?.trim()||'';
    const type=/^Consumer Price Index\b/i.test(name)?'cpi':/^Employment Situation\b/i.test(name)?'nfp':null;
    if(!type)continue;
    const start=block.match(/(?:^|\n)DTSTART([^:\r\n]*):(\d{8})T(\d{6})(Z?)/);
    if(!start)throw Error('BLS release time missing');
    const day=`${start[2].slice(0,4)}-${start[2].slice(4,6)}-${start[2].slice(6)}`;
    const clock=`${start[3].slice(0,2)}:${start[3].slice(2,4)}`;
    const tz=start[1].match(/TZID="?([^;"\r\n]+)/)?.[1]||'America/New_York';
    if(!['America/New_York','US/Eastern','US-Eastern','Eastern Standard Time'].includes(tz)&&!start[4])throw Error('BLS timezone unsupported');
    out.push([type,start[4]?new Date(`${day}T${clock}:00Z`).toISOString():zonedTime(day,clock,'America/New_York')]);
  }
  return out;
}
export function parseBea(text){
  const data=JSON.parse(text),out=[];
  for(const [label,type] of [['Gross Domestic Product','gdp'],['Personal Income and Outlays','pce']]){
    if(!Array.isArray(data[label]?.release_dates))throw Error(`BEA missing ${label}`);
    for(const t of data[label].release_dates){
      if(!/T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(t)||!Number.isFinite(Date.parse(t)))throw Error('BEA time invalid');
      out.push([type,new Date(t).toISOString()]);
    }
  }
  return out;
}
export function parseFed(html){
  const out=[];
  for(const section of html.matchAll(/(20\d{2}) FOMC Meetings([\s\S]*?)(?=<h4|$)/g)){
    for(const m of section[2].matchAll(/class="[^"]*fomc-meeting__month[^\"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="[^"]*fomc-meeting__date[^\"]*"[^>]*>([\s\S]*?)<\/div>/g)){
      const ms=plain(m[1]).split('/'),ds=plain(m[2]);
      if(!/^\d{1,2}-\d{1,2}\*?$/.test(ds))continue; // Excludes unscheduled notation votes.
      const mo=month(ms.at(-1)),end=Number(ds.replace('*','').split('-').at(-1));
      if(!mo)throw Error('FOMC month invalid');
      const day=date(section[1],mo,end);
      out.push([ds.includes('*')?'fomc_sep':'fomc',zonedTime(day,'14:00','America/New_York')],['fed_press',zonedTime(day,'14:30','America/New_York')]);
    }
  }
  return out;
}
export function parseBoj(html){
  const out=[];
  for(const section of html.matchAll(/<h2 id="p(20\d{2})"[^>]*>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/g)){
    for(const row of section[2].matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g)){
      const label=plain(row[1]).replace(/\[PDF.*$/,'').trim();
      const match=label.match(/^([A-Za-z.]+)\s+\d+\s*\([^)]*\),\s*(?:([A-Za-z.]+)\s+)?(\d+)\s*\(/);
      if(!match)throw Error('BOJ meeting date invalid');
      out.push(['boj',date(section[1],month(match[2]||match[1]),Number(match[3]))]);
    }
  }
  return out;
}
export function parseJp(xml){
  const national=xml.match(/<class_1 name="全国">([\s\S]*?)<\/class_1>/)?.[1];
  if(!national)throw Error('Japan CPI national schedule missing');
  const out=[];
  for(const row of national.matchAll(/<class_2 name="[^"]*月分">([\s\S]*?)<\/class_2>/g)){
    const field=name=>row[1].match(new RegExp(`<release_${name}>(\\d+)</release_${name}>`))?.[1];
    out.push(['jp_cpi',zonedTime(date(field('year'),field('month'),field('day')),`${pad(field('hour'))}:${pad(field('minute'))}`,'Asia/Tokyo')]);
  }
  return out;
}
export function parseEcb(html){
  const out=[];
  for(const row of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)){
    const label=plain(row[2]);
    if(!/monetary policy meeting/i.test(label)||/non-monetary|Day 1/i.test(label)||!/press conference/i.test(label))continue;
    const d=plain(row[1]).match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);if(!d)throw Error('ECB date invalid');
    const day=date(d[3],d[2],d[1]);
    out.push(['ecb',zonedTime(day,'14:15','Europe/Berlin')],['ecb_press',zonedTime(day,'14:45','Europe/Berlin')]);
  }
  return out;
}
export const PARSERS={bls:parseBls,bea:parseBea,fed:parseFed,boj:parseBoj,jp:parseJp,ecb:parseEcb};
export function normalizeRows(rows,now=Date.now()){
  const cutoff=now-7*DAY,today=new Date(cutoff+9*3600000).toISOString().slice(0,10),end=now+WINDOW_DAYS*DAY;
  const unique=new Map();
  for(const row of rows){
    if(!Array.isArray(row)||row.length!==2||!TYPES[row[0]])throw Error('Economic row invalid');
    const [type,t]=row;
    if(typeof t!=='string'||!Number.isFinite(Date.parse(t))||!(t.length===10||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(t)))throw Error('Economic date invalid');
    if(t.length===10&&type!=='boj')throw Error('Release time required');
    if(new Date(t).toISOString().slice(0,10)!==t.slice(0,10))throw Error('Invalid calendar date');
    if((t.length===10?t<today:Date.parse(t)<cutoff)||Date.parse(t)>end)continue;
    unique.set(`${type}|${t}`,row);
  }
  return [...unique.values()].sort((a,b)=>a[1].localeCompare(b[1])||a[0].localeCompare(b[0]));
}
export function decodeSource(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const encoding=b[0]===255&&b[1]===254?'utf-16le':b[0]===254&&b[1]===255?'utf-16be':'utf-8';
  return new TextDecoder(encoding).decode(b);
}
export async function fetchSource(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(url,{signal:controller.signal,headers:{Accept:'text/calendar,application/json,application/xml,text/html','User-Agent':'VANTAGE economic calendar (daily schedule sync)'}});
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    const reader=res.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000)throw Error('Source too large');chunks.push(value);}}
    finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return decodeSource(bytes);
  }finally{clearTimeout(timer);}
}
function readRecord(raw){
  if(!raw)return {v:1,rows:ECONOMIC_SEED};
  const record=JSON.parse(raw);if(record.v!==1||!Array.isArray(record.rows))throw Error('Economic cache invalid');return record;
}
export async function syncEconomicEvents(env,{now=Date.now(),load=fetchSource}={}){
  const raw=await env.COCKPIT_KV.get(ECONOMIC_KEY),previous=readRecord(raw),results=[];
  // Six bounded requests in parallel; no retries or writes to earnings keys.
  const outcomes=await Promise.allSettled(Object.entries(SOURCES).map(async([source,url])=>{
    const parsed=PARSERS[source](await load(url));
    if(!parsed.length)throw Error('No recognizable schedule');
    const expected={bls:['cpi','nfp'],bea:['gdp','pce'],fed:['fed_press'],boj:['boj'],jp:['jp_cpi'],ecb:['ecb','ecb_press']}[source];
    if(expected.some(type=>!parsed.some(r=>r[0]===type)))throw Error('Incomplete source schedule');
    const rows=normalizeRows(parsed,now);
    if(!rows.length)throw Error('No upcoming releases; keep previous schedule');
    return rows;
  }));
  // Keep recently released rows even when the source switches to future releases.
  const rows=previous.rows.filter(r=>Date.parse(r[1])<now);
  Object.keys(SOURCES).forEach((source,i)=>{
    const outcome=outcomes[i];
    if(outcome.status==='fulfilled'){rows.push(...outcome.value);results.push({source,ok:true,count:outcome.value.length});}
    else{rows.push(...previous.rows.filter(r=>TYPES[r[0]]?.[3]===source));results.push({source,ok:false,error:String(outcome.reason?.message||outcome.reason).slice(0,120)});}
  });
  const record={v:1,rows:normalizeRows(rows,now)},value=JSON.stringify(record),bytes=new TextEncoder().encode(value).length;
  if(bytes>MAX_BYTES||record.rows.length>256)throw Error('Economic schedule exceeds storage budget');
  const changed=value!==raw&&(raw!==null||record.rows.length>0);
  if(changed)await env.COCKPIT_KV.put(ECONOMIC_KEY,value);
  const report={event:'economic_sync',ok:results.every(x=>x.ok),changed,bytes,count:record.rows.length,sources:results};
  console.log(JSON.stringify(report));return report;
}
export async function getEconomicEvents(env,now=Date.now()){
  // A failed macro read must never break existing earnings or manual events.
  try{
    const record=readRecord(await env.COCKPIT_KV.get(ECONOMIC_KEY,{cacheTtl:3600}));
    return normalizeRows(record.rows,now).map(([type,t])=>{
      const [name,market,importance,source]=TYPES[type],dateOnly=t.length===10;
      const time=dateOnly?`${t}T14:59:59.999Z`:t; // Sort/expiry boundary only, never displayed as a release time.
      const jst=new Date(Date.parse(time)+9*3600000).toISOString();
      return {id:`economic-${type}-${t.slice(0,10)}`,name,time,time_note:dateOnly?'時刻未定':`${jst.slice(11,16)} JST`,date_only:dateOnly,event_date:dateOnly?t:jst.slice(0,10),category:'macro',symbols:[],source:'official',official_kind:'economic',source_name:SOURCE_NAMES[source],source_url:SOURCES[source],market,importance,read_only:true,pinned:false};
    });
  }catch(error){console.error('[economic read]',error.message);return [];}
}

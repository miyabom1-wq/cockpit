import { KEYS } from '../storage/kv-schema.js';
import { finite, jstDate, nowIso, parseJson, round } from '../utils.js';

const MAX_HISTORY=90;
const THEME_BUCKETS=[
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

function themeName(row){
  const symbol=String(row?.symbol||'').toUpperCase();
  for(const [name,set] of THEME_BUCKETS)if(set.has(symbol))return name;
  return row?.theme||'その他';
}
function average(rows,key){
  const xs=rows.map(x=>Number(x?.[key])).filter(Number.isFinite);
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
}
function stats(rows=[]){
  const n=rows.length;if(!n)return null;
  const count=lane=>rows.filter(x=>x.entry_lane===lane).length;
  const a=count('A'),b=count('B'),c=count('C'),e=count('E');
  const improving=rows.filter(x=>finite(x.rs5)&&finite(x.rs20)&&Number(x.rs5)>Number(x.rs20)).length/n*100;
  return{
    n,a,b,c,e,
    aRate:a/n,bRate:b/n,cRate:c/n,eRate:e/n,abRate:(a+b)/n,bcRate:(b+c)/n,
    rs5:average(rows,'rs5'),rs20:average(rows,'rs20'),
    vol:average(rows,'effective_vol_ratio')??average(rows,'vol_ratio'),
    breadth:rows.filter(x=>Number(x.ret5??x.change_pct)>0).length/n*100,
    hot:rows.filter(x=>Number(x.rsi14)>=75||Number(x.div25)>=10).length/n*100,
    improving
  };
}
function regionConfidence(n){
  const x=Number(n)||0;
  if(x>=5)return 1;if(x===4)return .9;if(x===3)return .8;if(x===2)return .55;if(x===1)return .3;return 0;
}
function shrinkMetric(value,confidence,neutral){
  return finite(value)?neutral+confidence*(Number(value)-neutral):neutral;
}
function balancedMetric(jp,us,key,neutral=0){
  if(jp&&us)return(shrinkMetric(jp[key],regionConfidence(jp.n),neutral)+shrinkMetric(us[key],regionConfidence(us.n),neutral))/2;
  const one=jp||us;return one?shrinkMetric(one[key],regionConfidence(one.n),neutral):null;
}
function confidenceMeta(jp,us){
  const jc=regionConfidence(jp?.n),uc=regionConfidence(us?.n),both=Boolean(jp&&us);
  const confidence=both?(jc+uc)/2*100:Math.max(jc,uc)*55;
  const coverage=both?(jp.n>=3&&us.n>=3?'日米確認':'日米・母数注意'):jp?'日本単独':'米国単独';
  return{confidence:round(confidence,0),jp_confidence:round(jc*100,0),us_confidence:round(uc*100,0),coverage,nominal_weights:both?{jp:50,us:50}:jp?{jp:100,us:0}:{jp:0,us:100}};
}
function propagationLabel(jp,us){
  if(jp&&us){
    if((us.rs5??0)>1&&(jp.rs5??0)<0)return'米国先行・日本未追随';
    if((us.rs20??0)>0&&(jp.rs5??0)>0&&(jp.rs20??0)<=0)return'日本追随開始';
    const d=(us.rs5??0)-(jp.rs5??0);if(d>2)return'米国先行';if(d<-2)return'日本先行';return'日米同時';
  }
  return jp?'日本のみ':'米国のみ';
}
function classify(m,regional={}){
  const n=m?.n||0,a=m?.a||0,b=m?.b||0,c=m?.c||0,e=m?.e||0;
  const rs5=m?.rs5,rs20=m?.rs20,breadth=m?.breadth??0,hot=m?.hot??0,improving=m?.improving??0;
  const abRate=m?.abRate??(n?(a+b)/n:0),bcRate=m?.bcRate??(n?(b+c)/n:0),eRate=m?.eRate??(n?e/n:0);
  let code='WAIT',label='待機',kind='neutral',reason='明確な資金集中は未確認';
  if(eRate>=.3||((rs5??0)<=-4&&(rs20??0)<=-3)){code='BREAKDOWN';label='崩壊';kind='bad';reason='警戒銘柄と相対劣後が優勢';}
  else if(hot>=25&&((rs20??0)>=4||(rs5??0)>=6)){code='OVERHEAT';label='過熱';kind='hot';reason='上昇は強いが過熱銘柄が増加';}
  else if(abRate>=.35&&(rs5??0)>1&&(rs20??0)>=0&&breadth>=55){code='EXPANSION';label='拡大';kind='good';reason='A・B候補と上昇銘柄の広がりを確認';}
  else if((rs20??0)<0&&(rs5??0)>(rs20??0)+2&&bcRate>=.25){code='RECOVERY';label='修復';kind='repair';reason='中期劣後の中で短期相対強度が反転';}
  else if(b>=1&&(rs5??0)>0&&improving>=40){code='GERMINATION';label='発芽';kind='seed';reason='反転初動と短期相対強度の改善を確認';}
  const jp=regional.jp||null,us=regional.us||null,meta=confidenceMeta(jp,us);
  const provisional=meta.confidence<60&&['GERMINATION','EXPANSION'].includes(code);
  if(provisional){label+='候補';reason+='。ただし地域またはテーマ母数が少ないため確認継続';}
  const score=round(
    (Number(rs5)||0)*1.8+(Number(rs20)||0)*.8+(breadth-50)*.08+(improving-50)*.04+
    abRate*18-eRate*20-(hot>35?(hot-35)*.12:0),1
  );
  return{
    code,label,kind,reason,score,provisional,
    n,a,b,c,e,rs5:round(rs5),rs20:round(rs20),vol:round(m?.vol),breadth:round(breadth,1),hot:round(hot,1),improving:round(improving,1),
    abRate:round(abRate,4),bcRate:round(bcRate,4),eRate:round(eRate,4),
    jp:compactRegion(jp),us:compactRegion(us),...meta,
    propagation:propagationLabel(jp,us)
  };
}
function compactRegion(x){
  if(!x)return null;
  return{n:x.n,a:x.a,b:x.b,c:x.c,e:x.e,rs5:round(x.rs5),rs20:round(x.rs20),vol:round(x.vol),breadth:round(x.breadth,1),improving:round(x.improving,1),abRate:round(x.abRate,4),eRate:round(x.eRate,4)};
}
function balanced(jpRows,usRows){
  const jp=stats(jpRows),us=stats(usRows),active=[jp,us].filter(Boolean);
  if(!active.length)return classify({n:0},{jp,us});
  const m={n:(jp?.n||0)+(us?.n||0),a:(jp?.a||0)+(us?.a||0),b:(jp?.b||0)+(us?.b||0),c:(jp?.c||0)+(us?.c||0),e:(jp?.e||0)+(us?.e||0)};
  const neutral={aRate:0,bRate:0,cRate:0,eRate:0,abRate:0,bcRate:0,rs5:0,rs20:0,vol:1,breadth:50,hot:0,improving:50};
  for(const k of Object.keys(neutral))m[k]=balancedMetric(jp,us,k,neutral[k]);
  return classify(m,{jp,us});
}
function stageRows(stage){return Object.values(stage?.stocks||{}).filter(x=>x&&x.symbol);}
function macroRisk(jpStage,usStage){
  const macro={...(usStage?.macro||{}),...(jpStage?.macro||{})};
  const keys=['S&P500','SOX','韓国KOSPI','日経平均'];let score=0,seen=0;
  for(const key of keys){const v=Number(macro[key]?.ret5);if(Number.isFinite(v)){seen++;score+=v>0?1:v<0?-1:0;}}
  const vx=Number(macro.VIX?.ret5);if(Number.isFinite(vx)){seen++;score+=vx<0?1:vx>0?-1:0;}
  return{label:score>=3?'世界リスクオン':score<=-3?'世界リスクオフ':'世界地合い中立',score,seen};
}
export function buildThemeSnapshotFromStages(jpStage={},usStage={},date=jstDate()){
  const groups=new Map();
  const add=(row,market)=>{const name=themeName(row);if(!groups.has(name))groups.set(name,{jp:[],us:[]});groups.get(name)[market].push(row);};
  for(const row of stageRows(jpStage))add(row,'jp');
  for(const row of stageRows(usStage))add(row,'us');
  const themes={};
  for(const [name,g] of groups){themes[name]=balanced(g.jp,g.us);}
  return{
    date,
    captured_at:nowIso(),
    jp_trade_date:jpStage?.trade_date||null,
    us_trade_date:usStage?.trade_date||null,
    jp_snapshot_id:jpStage?.snapshot_id||null,
    us_snapshot_id:usStage?.snapshot_id||null,
    risk:macroRisk(jpStage,usStage),
    themes
  };
}
function getTheme(snapshot,name){return snapshot?.themes?.[name]||null;}
function delta(current,past,key){
  const a=current?.[key],b=past?.[key];return finite(a)&&finite(b)?round(Number(a)-Number(b),1):null;
}
function trendLabel(d1,d3,d5){
  const vals=[d1,d3,d5].filter(finite).map(Number);
  if(!vals.length)return'蓄積中';
  const recent=finite(d1)?Number(d1):vals[0],medium=finite(d3)?Number(d3):finite(d5)?Number(d5):recent;
  if(recent>=2&&medium>=1)return'加速';
  if(recent<=-2&&medium<=-1)return'失速';
  if(recent>0)return'改善';
  if(recent<0)return'鈍化';
  return'横ばい';
}
function enrichCurrent(current,history){
  if(!current)return null;
  const prior=history.filter(x=>x.date<current.date).sort((a,b)=>b.date.localeCompare(a.date));
  const p1=prior[0],p3=prior[2],p5=prior[4];
  const themes={};
  for(const [name,t] of Object.entries(current.themes||{})){
    const d1=delta(t,getTheme(p1,name),'score'),d3=delta(t,getTheme(p3,name),'score'),d5=delta(t,getTheme(p5,name),'score');
    const previous=getTheme(p1,name),transition=previous&&previous.code!==t.code?`${previous.label}→${t.label}`:null;
    themes[name]={...t,change:{d1,d3,d5,label:trendLabel(d1,d3,d5)},transition,previous_code:previous?.code||null};
  }
  return{...current,themes};
}
function alertsFrom(current){
  const out=[];
  for(const [name,t] of Object.entries(current?.themes||{})){
    if(t.transition)out.push({theme:name,type:'transition',label:t.transition,score:t.score,change:t.change});
    else if(['加速','失速'].includes(t.change?.label))out.push({theme:name,type:t.change.label==='加速'?'acceleration':'deceleration',label:t.change.label,score:t.score,change:t.change});
  }
  const priority={transition:0,acceleration:1,deceleration:2};
  return out.sort((a,b)=>(priority[a.type]??9)-(priority[b.type]??9)||Math.abs(Number(b.change?.d1)||0)-Math.abs(Number(a.change?.d1)||0)).slice(0,8);
}
async function readHistory(env){return parseJson(await env.COCKPIT_KV.get(KEYS.themeHistory),[])||[];}
export async function captureThemeSnapshot(env,source='auto'){
  const [jpStage,usStage,history]=await Promise.all([
    env.COCKPIT_KV.get(KEYS.stage('jp')).then(x=>parseJson(x,{})),
    env.COCKPIT_KV.get(KEYS.stage('us')).then(x=>parseJson(x,{})),
    readHistory(env)
  ]);
  if(!jpStage?.complete&&!usStage?.complete)return{ok:false,skipped:true,reason:'stage data unavailable'};
  const snapshot={...buildThemeSnapshotFromStages(jpStage,usStage,jstDate()),source};
  const next=[...history.filter(x=>x.date!==snapshot.date),snapshot].sort((a,b)=>a.date.localeCompare(b.date)).slice(-MAX_HISTORY);
  await env.COCKPIT_KV.put(KEYS.themeHistory,JSON.stringify(next));
  return{ok:true,snapshot,count:next.length};
}
export async function getThemeHistory(env,limit=30){
  const [jpStage,usStage,history]=await Promise.all([
    env.COCKPIT_KV.get(KEYS.stage('jp')).then(x=>parseJson(x,{})),
    env.COCKPIT_KV.get(KEYS.stage('us')).then(x=>parseJson(x,{})),
    readHistory(env)
  ]);
  const currentRaw=buildThemeSnapshotFromStages(jpStage,usStage,jstDate());
  const merged=[...history.filter(x=>x.date!==currentRaw.date),currentRaw].sort((a,b)=>a.date.localeCompare(b.date));
  const current=enrichCurrent(currentRaw,merged);
  const size=Math.max(1,Math.min(90,Number(limit)||30));
  return{ok:true,current,alerts:alertsFrom(current),history:merged.slice(-size),history_days:merged.length,methodology:'実際の資金流入額ではなく、日米50:50を基準に、片側3銘柄未満を中立方向へ縮小補正した相対強度・広がり・出来高・A〜E候補レーンの代理指標'};
}

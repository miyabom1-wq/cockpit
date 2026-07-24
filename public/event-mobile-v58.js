(()=>{
'use strict';
const PATCH='v58-event-mobile-tidy-20260724';
if(window.__vantageV58Patch===PATCH)return;
window.__vantageV58Patch=PATCH;

function installStyle(){
  if(document.getElementById('v58-style'))return;
  const style=document.createElement('style');
  style.id='v58-style';
  style.textContent=`
    .v58-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .v58-toolbar .fresh{margin-left:auto}
    .v58-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0 12px}
    .v58-kpi{border:1px solid var(--line,#dfe3e8);border-radius:14px;padding:10px 11px;background:var(--card,#fff)}
    .v58-kpi strong{display:block;font-size:19px;line-height:1.1}
    .v58-kpi span{display:block;font-size:11px;color:var(--muted,#667085);margin-top:4px}
    .v58-sourcebar{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 12px}
    .v58-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:5px 9px;font-size:11px;background:#fff}
    .v58-pill.ok{background:#effaf3;border-color:#a6d6b3;color:#1e6c3e}
    .v58-pill.warn{background:#fff8e8;border-color:#e9c988;color:#8b5e08}
    .v58-section{margin-top:14px}
    .v58-section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .v58-section-head h3{margin:0;flex:1;font-size:14px}
    .v58-section-head small{color:var(--muted,#667085);font-size:11px}
    .v58-daygroup{border:1px solid var(--line,#dfe3e8);border-radius:14px;background:var(--card,#fff);overflow:hidden;margin-bottom:10px}
    .v58-dayhead{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line,#eef1f4);background:#f8fafb}
    .v58-datebadge{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:50px;border-radius:12px;padding:6px 8px;background:#0d6c63;color:#fff}
    .v58-datebadge b{font-size:16px;line-height:1}
    .v58-datebadge span{font-size:10px;opacity:.9}
    .v58-daymeta{flex:1;min-width:0}
    .v58-daymeta b{display:block;font-size:13px}
    .v58-daymeta small{color:var(--muted,#667085);font-size:11px}
    .v58-eventrow{display:flex;gap:10px;padding:10px 12px;border-top:1px solid var(--line,#eef1f4)}
    .v58-eventmain{min-width:0;flex:1}
    .v58-eventtitle{font-size:13px;line-height:1.35;font-weight:700}
    .v58-eventsub{margin-top:4px;font-size:11px;color:var(--muted,#667085);display:flex;gap:8px;flex-wrap:wrap}
    .v58-tag{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700}
    .v58-tag.jpx{background:#e8f3ff;color:#145da0}
    .v58-tag.ir{background:#edf8ef;color:#23733b}
    .v58-tag.provider{background:#fff6df;color:#8a5b08}
    .v58-tag.manual{background:#f1f2f4;color:#555}
    .v58-side{min-width:56px;text-align:right}
    .v58-side b{display:block;font-size:12px}
    .v58-side small{display:block;color:var(--muted,#667085);font-size:10px;margin-top:3px}
    .v58-details{margin-top:10px}
    .v58-details>summary{cursor:pointer;color:var(--muted,#667085);font-size:12px;padding:0 4px}
    .v58-chiplist{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .v58-chiplist span{font-size:11px;border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:4px 8px;background:#fff}
    .v58-note{font-size:11px;color:var(--muted,#667085);line-height:1.6}
    .v58-empty{border:1px dashed var(--line,#dfe3e8);border-radius:14px;padding:16px 12px;background:var(--card,#fff);font-size:12px;color:var(--muted,#667085)}
    @media(max-width:760px){
      .v58-toolbar .fresh{margin-left:0;width:100%}
      .v58-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v58-datebadge{min-width:44px;padding:5px 6px}
      .v58-datebadge b{font-size:14px}
      .v58-eventrow{padding:9px 10px}
      .v58-side{min-width:46px}
      .v58-eventtitle{font-size:12px}
      .v58-eventsub{font-size:10px}
      .v58-kpi strong{font-size:18px}
    }
  `;
  document.head.appendChild(style);
}

function srcInfo(event){
  const name=String(event?.source_name||'');
  if(event?.official_kind==='jpx'||name.startsWith('JPX'))return{label:'JPX公式',cls:'jpx'};
  if(event?.source==='official')return{label:'企業IR',cls:'ir'};
  if(event?.source==='provider')return{label:'Yahoo参考',cls:'provider'};
  return{label:'手動',cls:'manual'};
}

function shortDate(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return'';
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function dayKey(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return'unknown';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dayHeader(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return{month:'?',day:'?',label:'日付不明'};
  const weekdays=['日','月','火','水','木','金','土'];
  return {month:`${d.getMonth()+1}月`,day:String(d.getDate()),label:`${d.getMonth()+1}/${d.getDate()}(${weekdays[d.getDay()]})`};
}
function timeLabel(event){
  const note=String(event?.time_note||'').trim();
  if(note && !/時刻未確認/.test(note))return note;
  if(note)return note.replace(/・?時刻未確認/g,'').trim()||shortDate(event.time);
  const source=srcInfo(event);
  if(source.cls==='jpx')return `${shortDate(event.time)} ・ 時間未公表`;
  if(source.cls==='provider')return `${shortDate(event.time)} ・ 参考日程`;
  return shortDate(event.time);
}
function symbolLabel(event){
  const symbols=(event?.symbols||[]).map(x=>typeof code==='function'?code(x):x);
  return symbols.join(' / ');
}
function marketOf(event){
  const s=String(event?.symbols?.[0]||'').toUpperCase();
  return /\.T$/.test(s)?'日本':'米国';
}
function dText(event){
  const diff=new Date(event.time).getTime()-Date.now();
  if(!Number.isFinite(diff))return'';
  const days=Math.ceil(diff/86400000);
  if(days<=0)return'当日';
  if(days===1)return'D-1';
  return `D-${days}`;
}

function eventRow(event){
  const source=srcInfo(event);
  const symbols=symbolLabel(event);
  return `
    <div class="v58-eventrow">
      <div class="v58-eventmain">
        <div class="v58-eventtitle">${esc(event.name||'イベント')}</div>
        <div class="v58-eventsub">
          <span>${esc(timeLabel(event))}</span>
          ${symbols?`<span>${esc(symbols)}</span>`:''}
          <span>${esc(marketOf(event))}</span>
          <span class="v58-tag ${source.cls}">${source.label}</span>
        </div>
      </div>
      <div class="v58-side">
        <b>${esc(dText(event))}</b>
        <small>${esc(event.category==='earnings'?'決算':(event.category||'予定'))}</small>
      </div>
    </div>
  `;
}

function dayGroup(key,rows){
  const head=dayHeader(rows[0]?.time||key);
  return `
    <div class="v58-daygroup">
      <div class="v58-dayhead">
        <div class="v58-datebadge"><span>${head.month}</span><b>${head.day}</b></div>
        <div class="v58-daymeta">
          <b>${head.label}</b>
          <small>${rows.length}件</small>
        </div>
      </div>
      ${rows.map(eventRow).join('')}
    </div>
  `;
}

function groupedList(rows,maxVisible){
  if(!rows.length)return '';
  const groups=new Map();
  for(const row of rows){
    const key=dayKey(row.time);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const all=[...groups.entries()].map(([k,v])=>dayGroup(k,v));
  if(!maxVisible || rows.length<=maxVisible)return all.join('');
  let count=0;
  const visible=[],hidden=[];
  for(const [k,v] of groups.entries()){
    const block=dayGroup(k,v);
    if(count<maxVisible){
      visible.push(block);
      count+=v.length;
    }else{
      hidden.push(block);
    }
  }
  const hiddenRows=Math.max(0,rows.length-count);
  return `${visible.join('')}
    <details class="v58-details">
      <summary>残り ${hiddenRows} 件を表示</summary>
      <div style="margin-top:8px">${hidden.join('')}</div>
    </details>`;
}

function coveragePanel(cov){
  const total=Number(cov?.tracked_total)||0;
  const got=Number(cov?.earnings_found)||0;
  const missing=Number(cov?.not_listed_total ?? cov?.missing_total)||0;
  const unchecked=Number(cov?.unchecked_total)||0;
  const jp=cov?.by_market?.jp||{};
  const us=cov?.by_market?.us||{};
  const jpx=cov?.jpx||{};
  const sourceClass=jpx.available&&!jpx.stale?'ok':'warn';
  const sourceText=jpx.available
    ?`JPX公式 ${jpx.event_count||0}件・${jpx.generated_at?dateText(jpx.generated_at):'更新時刻なし'}${jpx.stale?'（保存済み）':''}`
    :`JPX公式未取得${jpx.error?'・'+jpx.error:''}`;
  const missingRows=(cov?.missing_symbols||[]).slice(0,60);
  const uncheckedRows=(cov?.unchecked_symbols||[]).slice(0,60);

  return `
    <div class="v58-summary">
      <div class="v58-kpi"><strong>${total}</strong><span>対象銘柄</span></div>
      <div class="v58-kpi"><strong>${got}</strong><span>決算予定取得</span></div>
      <div class="v58-kpi"><strong>${missing}</strong><span>予定日未掲載</span></div>
      <div class="v58-kpi"><strong>${unchecked}</strong><span>未確認</span></div>
    </div>
    <div class="v58-sourcebar">
      <span class="v58-pill ${sourceClass}">${esc(sourceText)}</span>
      <span class="v58-pill">日本 ${jp.found||0}/${jp.total||0}</span>
      <span class="v58-pill">米国 ${us.found||0}/${us.total||0}</span>
      <span class="v58-pill">最終確認 ${cov?.last_checked_at?dateText(cov.last_checked_at):'なし'}</span>
    </div>
    <div class="v58-note">
      直近判断に必要な情報だけ見やすく表示します。時刻が取れない日本株の多くは、JPX公式では日付のみ公開のため「時間未公表」と表示します。Yahooの補完分は参考日程です。
    </div>
    <details class="v58-details">
      <summary>カバー状況の詳細</summary>
      <div class="v58-chiplist">
        <span>日本 JPX公式 ${jp.jpx||0}</span>
        <span>日本 Yahoo補完 ${jp.provider||0}</span>
        <span>米国 Yahoo補完 ${us.provider||0}</span>
        <span>企業IR ${cov?.official_found||0}</span>
      </div>
    </details>
    ${missingRows.length?`
    <details class="v58-details">
      <summary>予定日未掲載の銘柄 ${missing}件</summary>
      <div class="v58-chiplist">${missingRows.map(x=>`<span>${esc((typeof code==='function'?code(x.symbol):x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div>
    </details>`:''}
    ${uncheckedRows.length?`
    <details class="v58-details">
      <summary>未確認の銘柄 ${unchecked}件</summary>
      <div class="v58-chiplist">${uncheckedRows.map(x=>`<span>${esc((typeof code==='function'?code(x.symbol):x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div>
    </details>`:''}
  `;
}

function section(title,subtitle,rows,empty,maxVisible){
  return `
    <section class="v58-section">
      <div class="v58-section-head">
        <h3>${esc(title)}</h3>
        <small>${esc(subtitle)} · ${rows.length}件</small>
      </div>
      ${rows.length ? groupedList(rows,maxVisible) : `<div class="v58-empty">${esc(empty)}</div>`}
    </section>
  `;
}

window.renderEvents=function(){
  const root=document.getElementById('event-list');
  if(!root)return;
  const now=Date.now();
  const ten=now+10*86400000;
  const max=now+120*86400000;
  const mobile=window.innerWidth<=760;

  const rows=(state.events?.events||[])
    .slice()
    .sort((a,b)=>new Date(a.time)-new Date(b.time));

  const future=rows.filter(x=>{
    const t=new Date(x.time).getTime();
    return Number.isFinite(t)&&t>=now&&t<=max;
  });

  const near=future.filter(x=>new Date(x.time).getTime()<=ten);
  const later=future.filter(x=>new Date(x.time).getTime()>ten);
  const earnings=later.filter(x=>x.category==='earnings');
  const general=later.filter(x=>x.category!=='earnings');

  root.innerHTML = `
    <div class="v58-toolbar">
      <button class="primary small" onclick="loadEvents(true)">決算予定を更新</button>
      <span class="fresh">直近10日 / 決算予定 / 経済指標 の3区分表示</span>
    </div>
    ${coveragePanel(state.events?.coverage||{})}
    ${section('直近10日の重要日程','売買判断向け',near,'直近10日の重要日程はありません',mobile?12:20)}
    ${section('決算予定','11〜120日先',earnings,'11〜120日先の決算予定はありません',mobile?18:36)}
    ${section('通常イベント・経済指標','11〜120日先',general,'通常イベント・指標はありません',mobile?8:16)}
  `;
};

installStyle();
const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v58';
})();
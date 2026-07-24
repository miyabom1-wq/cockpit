(()=>{
'use strict';
const PATCH='v59-event-accordion-cleanup-20260724';
if(window.__vantageV59Patch===PATCH)return;
window.__vantageV59Patch=PATCH;

function installStyle(){
  if(document.getElementById('v59-style'))return;
  const style=document.createElement('style');
  style.id='v59-style';
  style.textContent=`
    .v59-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .v59-toolbar .fresh{margin-left:auto}
    .v59-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0 12px}
    .v59-kpi{border:1px solid var(--line,#dfe3e8);border-radius:14px;padding:10px 11px;background:var(--card,#fff)}
    .v59-kpi strong{display:block;font-size:19px;line-height:1.1}
    .v59-kpi span{display:block;font-size:11px;color:var(--muted,#667085);margin-top:4px}
    .v59-sourcebar{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 12px}
    .v59-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:5px 9px;font-size:11px;background:#fff}
    .v59-pill.ok{background:#effaf3;border-color:#a6d6b3;color:#1e6c3e}
    .v59-pill.warn{background:#fff8e8;border-color:#e9c988;color:#8b5e08}
    .v59-section{margin-top:14px}
    .v59-section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .v59-section-head h3{margin:0;flex:1;font-size:14px}
    .v59-section-head small{color:var(--muted,#667085);font-size:11px}
    .v59-daygroup{border:1px solid var(--line,#dfe3e8);border-radius:14px;background:var(--card,#fff);overflow:hidden;margin-bottom:10px}
    .v59-daygroup[open] .v59-dayhead{border-bottom:1px solid var(--line,#eef1f4)}
    .v59-dayhead{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f8fafb;cursor:pointer;list-style:none}
    .v59-dayhead::-webkit-details-marker{display:none}
    .v59-datebadge{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:50px;border-radius:12px;padding:6px 8px;background:#0d6c63;color:#fff}
    .v59-datebadge b{font-size:16px;line-height:1}
    .v59-datebadge span{font-size:10px;opacity:.9}
    .v59-daymeta{flex:1;min-width:0}
    .v59-daymeta b{display:block;font-size:13px}
    .v59-daymeta small{display:block;color:var(--muted,#667085);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v59-caret{font-size:14px;color:var(--muted,#667085);transition:transform .18s ease}
    .v59-daygroup[open] .v59-caret{transform:rotate(90deg)}
    .v59-eventrow{display:flex;gap:10px;padding:10px 12px;border-top:1px solid var(--line,#eef1f4)}
    .v59-eventmain{min-width:0;flex:1}
    .v59-eventtitle{font-size:13px;line-height:1.35;font-weight:700}
    .v59-eventsub{margin-top:4px;font-size:11px;color:var(--muted,#667085);display:flex;gap:8px;flex-wrap:wrap}
    .v59-tag{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700}
    .v59-tag.jpx{background:#e8f3ff;color:#145da0}
    .v59-tag.ir{background:#edf8ef;color:#23733b}
    .v59-tag.provider{background:#fff6df;color:#8a5b08}
    .v59-tag.manual{background:#f1f2f4;color:#555}
    .v59-side{min-width:52px;text-align:right}
    .v59-side b{display:block;font-size:12px}
    .v59-side small{display:block;color:var(--muted,#667085);font-size:10px;margin-top:3px}
    .v59-details{margin-top:10px}
    .v59-details>summary{cursor:pointer;color:var(--muted,#667085);font-size:12px;padding:0 4px}
    .v59-chiplist{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .v59-chiplist span{font-size:11px;border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:4px 8px;background:#fff}
    .v59-note{font-size:11px;color:var(--muted,#667085);line-height:1.6}
    .v59-empty{border:1px dashed var(--line,#dfe3e8);border-radius:14px;padding:16px 12px;background:var(--card,#fff);font-size:12px;color:var(--muted,#667085)}
    .v59-more-fallback{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;border:1px solid currentColor;font-weight:700;font-size:12px;line-height:1}
    @media(max-width:760px){
      .v59-toolbar .fresh{margin-left:0;width:100%}
      .v59-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v59-datebadge{min-width:44px;padding:5px 6px}
      .v59-datebadge b{font-size:14px}
      .v59-eventrow{padding:9px 10px}
      .v59-side{min-width:44px}
      .v59-eventtitle{font-size:12px}
      .v59-eventsub{font-size:10px}
      .v59-kpi strong{font-size:18px}
    }
  `;
  document.head.appendChild(style);
}

function patchMoreIconFallback(){
  const targets=[...document.querySelectorAll('button,a,[role="button"]')];
  for(const el of targets){
    const label=((el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.title||'')).replace(/\s+/g,'');
    if(!/その他|more/i.test(label))continue;
    const iconSlot=el.querySelector('.icon,[class*="icon"],[data-icon]');
    if(iconSlot){
      const empty=!iconSlot.querySelector('svg,img') && !iconSlot.textContent.trim();
      if(empty)iconSlot.textContent='⋯';
    }else if(!el.querySelector('.v59-more-fallback')){
      const span=document.createElement('span');
      span.className='v59-more-fallback';
      span.textContent='⋯';
      el.prepend(span);
    }
  }
}

function srcInfo(event){
  const name=String(event?.source_name||'');
  if(event?.official_kind==='jpx'||name.startsWith('JPX'))return{label:'JPX公式',cls:'jpx'};
  if(event?.provider_kind==='nasdaq_zacks')return{label:'Nasdaq参考',cls:'provider'};
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
function looksMacroEvent(event){
  const text=`${event?.name||''} ${event?.source_name||''}`.toUpperCase();
  return /FOMC|CPI|PCE|ISM|GDP|雇用統計|失業率|政策金利|日銀|ECB|PMI|小売売上高|PPI/.test(text);
}
function isCorporateEarnings(event){
  const symbols=Array.isArray(event?.symbols)?event.symbols.filter(Boolean):[];
  if(event?.category!=='earnings')return false;
  if(looksMacroEvent(event))return false;
  if(!symbols.length)return false;
  return true;
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
function cleanName(event){
  return String(event?.name||'\u30a4\u30d9\u30f3\u30c8')
    .replace(/\b[0-9]{3,6}\.T\b/g,' ')
    .replace(/\b20\d{2}-\d{2}-\d{2}(?:00:00:00)?\b/g,' ')
    .replace(/\b20\d{6}(?:\d{6})?\b/g,' ')
    .replace(/\s+(?:\u6c7a\u7b97\u4e88\u5b9a|\u6c7a\u7b97)\s*$/,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}
function previewNames(rows){
  const xs=[...new Set(rows.map(cleanName).filter(Boolean))].slice(0,2);
  return xs.join(' / ');
}
function eventRow(event){
  const source=srcInfo(event);
  return `
    <div class="v59-eventrow">
      <div class="v59-eventmain">
        <div class="v59-eventtitle">${esc(cleanName(event))}</div>
        <div class="v59-eventsub">
          <span>${esc(timeLabel(event))}</span>
          <span>${esc(marketOf(event))}</span>
          <span class="v59-tag ${source.cls}">${source.label}</span>
        </div>
      </div>
      <div class="v59-side">
        <b>${esc(dText(event))}</b>
        <small>${esc(looksMacroEvent(event)?'経済':(isCorporateEarnings(event)?'決算':'予定'))}</small>
      </div>
    </div>
  `;
}
function dayGroup(key,rows,openDefault=false){
  const head=dayHeader(rows[0]?.time||key);
  const preview=previewNames(rows);
  return `
    <details class="v59-daygroup" ${openDefault?'open':''}>
      <summary class="v59-dayhead">
        <div class="v59-datebadge"><span>${head.month}</span><b>${head.day}</b></div>
        <div class="v59-daymeta">
          <b>${head.label}</b>
          <small>${rows.length}件${preview?` ・ ${esc(preview)}`:''}</small>
        </div>
        <div class="v59-caret">›</div>
      </summary>
      ${rows.map(eventRow).join('')}
    </details>
  `;
}
function groupedList(rows,maxGroups,openFirst){
  if(!rows.length)return'';
  const groups=new Map();
  for(const row of rows){
    const key=dayKey(row.time);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const entries=[...groups.entries()];
  const visible=entries.slice(0,maxGroups);
  const hidden=entries.slice(maxGroups);
  const visibleHtml=visible.map(([k,v],idx)=>dayGroup(k,v,idx<openFirst)).join('');
  if(!hidden.length)return visibleHtml;
  const hiddenCount=hidden.reduce((n,[,v])=>n+v.length,0);
  return `${visibleHtml}
    <details class="v59-details">
      <summary>残り ${hiddenCount} 件を表示</summary>
      <div style="margin-top:8px">${hidden.map(([k,v])=>dayGroup(k,v,false)).join('')}</div>
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
  const usc=cov?.us_calendar||{};
  const sourceClass=jpx.available&&!jpx.stale?'ok':'warn';
  const sourceText=jpx.available
    ?`JPX公式 ${jpx.event_count||0}件・${jpx.generated_at?dateText(jpx.generated_at):'更新時刻なし'}${jpx.stale?'（保存済み）':''}`
    :`JPX公式未取得${jpx.error?'・'+jpx.error:''}`;
  const missingRows=(cov?.missing_symbols||[]).slice(0,40);
  return `
    <div class="v59-summary">
      <div class="v59-kpi"><strong>${total}</strong><span>対象銘柄</span></div>
      <div class="v59-kpi"><strong>${got}</strong><span>決算予定取得</span></div>
      <div class="v59-kpi"><strong>${missing}</strong><span>予定日未掲載</span></div>
      <div class="v59-kpi"><strong>${unchecked}</strong><span>未確認</span></div>
    </div>
    <div class="v59-sourcebar">
      <span class="v59-pill ${sourceClass}">${esc(sourceText)}</span>
      <span class="v59-pill ${usc.available&&!usc.stale?'ok':'warn'}">米国カレンダー ${usc.available?(usc.event_count||0)+'件':'未取得'}</span>
      <span class="v59-pill">日本 ${jp.found||0}/${jp.total||0}</span>
      <span class="v59-pill">米国 ${us.found||0}/${us.total||0}</span>
    </div>
    <div class="v59-note">
      決算は日付単位で折りたたみ表示に変更しました。JPX公式は日付のみ公開の銘柄が多いため、時刻欄は「時間未公表」と表示します。FOMCなどの手動イベントは決算から分離して一般イベント側に表示します。
    </div>
    ${missingRows.length?`
    <details class="v59-details">
      <summary>予定日未掲載の銘柄 ${missing}件</summary>
      <div class="v59-chiplist">${missingRows.map(x=>`<span>${esc((typeof code==='function'?code(x.symbol):x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div>
    </details>`:''}
  `;
}
function section(title,subtitle,rows,empty,maxGroups,openFirst){
  return `
    <section class="v59-section">
      <div class="v59-section-head">
        <h3>${esc(title)}</h3>
        <small>${esc(subtitle)} · ${rows.length}件</small>
      </div>
      ${rows.length ? groupedList(rows,maxGroups,openFirst) : `<div class="v59-empty">${esc(empty)}</div>`}
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
  const earnings=later.filter(isCorporateEarnings);
  const general=later.filter(x=>!isCorporateEarnings(x));

  root.innerHTML = `
    <div class="v59-toolbar">
      <button class="primary small" onclick="loadEvents(true)">決算予定を更新</button>
      <span class="fresh">日付タップで展開</span>
    </div>
    ${coveragePanel(state.events?.coverage||{})}
    ${section('直近10日の重要日程','売買判断向け',near,'直近10日の重要日程はありません',mobile?5:8,1)}
    ${section('決算予定','11〜120日先',earnings,'11〜120日先の決算予定はありません',mobile?6:10,0)}
    ${section('通常イベント・経済指標','11〜120日先',general,'通常イベント・指標はありません',mobile?4:8,0)}
  `;
  patchMoreIconFallback();
};

installStyle();
patchMoreIconFallback();
new MutationObserver(()=>patchMoreIconFallback()).observe(document.body,{childList:true,subtree:true});
const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v60';
})();
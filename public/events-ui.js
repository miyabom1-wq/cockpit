(()=>{
'use strict';
const EVENTS_UI_BUILD='weekly-events-20260923';
if(window.__vantageEventsUiBuild===EVENTS_UI_BUILD)return;
window.__vantageEventsUiBuild=EVENTS_UI_BUILD;

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
    .v59-eventrow.released{background:#f7f8fa}
    .v59-eventrow.released .v59-eventtitle{color:#747e89;font-weight:500}
    .v59-results{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:12px}
    .v59-eventactions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
    .v59-periods{display:flex;gap:7px;margin:12px 0}
    .v59-periods button[aria-pressed="true"]{background:#0d6c63;color:#fff}
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
  if(event?.source==='official')return{label:event.category==='earnings'?'企業IR':'公式',cls:'ir'};
  if(event?.source==='provider')return{label:'Yahoo参考',cls:'provider'};
  return{label:'手動',cls:'manual'};
}
function shortDate(iso){
  const d=new Date(Date.parse(iso)+9*3600000);
  if(Number.isNaN(d.getTime()))return'';
  return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
}
function dayKey(iso){
  const d=new Date(Date.parse(iso)+9*3600000);
  if(Number.isNaN(d.getTime()))return'unknown';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function dayHeader(iso){
  const d=new Date(Date.parse(iso)+9*3600000);
  if(Number.isNaN(d.getTime()))return{month:'?',day:'?',label:'日付不明'};
  const weekdays=['日','月','火','水','木','金','土'];
  return {month:`${d.getUTCMonth()+1}月`,day:String(d.getUTCDate()),label:`${d.getUTCMonth()+1}/${d.getUTCDate()}(${weekdays[d.getUTCDay()]})`};
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
  const date=shortDate(event?.time);
  const note=String(event?.time_note||'').trim();
  const cleaned=note
    .replace(/^\d{1,2}\/\d{1,2}\s*(?:[\u30fb\u00b7-]\s*)?/,'')
    .replace(/(?:\u6642\u523b\u672a\u78ba\u8a8d|\u6642\u523b\u672a\u516c\u8868|\u6642\u9593\u672a\u516c\u8868)/g,'')
    .replace(/^[\s\u30fb\u00b7-]+|[\s\u30fb\u00b7-]+$/g,'')
    .trim();
  if(cleaned)return date?date+' \u30fb '+cleaned:cleaned;
  if(looksMacroEvent(event)||['macro','centralbank'].includes(event.category))return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(event.time))+' JST';
  return date;
}
function marketOf(event){
  const s=String(event?.symbols?.[0]||'').toUpperCase();
  if(!s)return event.market==='jp'?'日本':event.market==='us'?'米国':'';
  return /\.T$/.test(s)?'日本':'米国';
}
function dText(event){
  const diff=new Date(event.time).getTime()-Date.now();
  if(!Number.isFinite(diff))return'';
  if(diff<0)return'発表済み';
  if(diff<=86400000)return'24h以内';
  return Math.ceil(diff/86400000)+'日';
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
function weekStart(now=Date.now()){
  const d=new Date(now+9*3600000);d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.getTime()-9*3600000;
}
function editable(event){return !event.read_only&&event.source!=='official'&&event.source!=='provider';}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function sourceUrl(event){
  const direct=safeUrl(event.source_url||event.url);if(direct)return direct;
  const name=String(event.name||'').toUpperCase();
  if(/日銀/.test(name))return 'https://www.boj.or.jp/mopo/mpmdeci/index.htm';
  if(/日本.*CPI|全国.*消費者|東京.*消費者/.test(name))return 'https://www.stat.go.jp/data/cpi/';
  if(/FOMC/.test(name))return 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
  if(/ECB/.test(name))return 'https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html';
  if(/PCE/.test(name))return 'https://www.bea.gov/data/personal-consumption-expenditures-price-index';
  if(/GDP/.test(name)&&event.market==='us')return 'https://www.bea.gov/data/gdp/gross-domestic-product';
  if(/CPI/.test(name)&&event.market!=='jp')return 'https://www.bls.gov/news.release/cpi.toc.htm';
  if(/PPI/.test(name)&&event.market!=='jp')return 'https://www.bls.gov/news.release/ppi.toc.htm';
  if(/雇用統計|非農業/.test(name)&&event.market!=='jp')return 'https://www.bls.gov/news.release/empsit.toc.htm';
  if(/PMI/.test(name))return 'https://www.pmi.spglobal.com/Public/Release/PressReleases';
  if(/ISM/.test(name))return 'https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/';
  if(/小売売上高/.test(name)&&event.market==='us')return 'https://www.census.gov/retail/index.html';
  const symbol=event.symbols?.[0];return symbol?'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/calendar/':'';
}
function numericValue(value){
  const s=String(value??'').trim().replace(/,/g,'').replace(/−/g,'-');
  // Compare only matching units; do not silently mix K, M, %, or ranges.
  const m=s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%|％|K|M|B|万人|人|兆円|億円|円|bp)?$/i);
  if(!m)return null;return{value:Number(m[1]),unit:(m[2]||'').replace('％','%').toUpperCase()};
}
function surprise(event){
  const a=numericValue(event.actual),f=numericValue(event.forecast);
  if(!a||!f||a.unit!==f.unit)return '';
  return '予想比 '+(a.value>f.value?'↑':a.value<f.value?'↓':'＝');
}
function resultsHtml(event){
  if(!looksMacroEvent(event)&&!['macro','centralbank'].includes(event.category)&&!['actual','forecast','previous'].some(k=>event[k]!=null))return '';
  const values=['actual','forecast','previous'].map((key,i)=>'<span>'+['実績','予想','前回'][i]+' <b>'+esc(event[key]===0?'0':event[key]||'—')+'</b></span>').join('');
  return '<div class="v59-results">'+values+(event.unit?'<span>'+esc(event.unit)+'</span>':'')+(surprise(event)?'<span>'+esc(surprise(event))+'</span>':'')+'</div>';
}
function eventRow(event){
  const source=srcInfo(event),past=Date.parse(event.time)<Date.now(),url=sourceUrl(event);
  return `
    <div class="v59-eventrow ${past?'released':''}">
      <div class="v59-eventmain">
        <div class="v59-eventtitle">${esc(cleanName(event))}${event.pinned?' · 固定':''}</div>
        <div class="v59-eventsub"><span>${esc(timeLabel(event))}</span><span>${esc(marketOf(event))}</span><span class="v59-tag ${source.cls}">${source.label}</span></div>
        ${resultsHtml(event)}
        <div class="v59-eventactions">
          ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">公式・データ元 ↗</a>`:''}
          ${editable(event)?`<button class="small" data-event-action="edit" data-event-id="${esc(event.id)}">実績・数値を編集</button><button class="small" data-event-action="pin" data-event-id="${esc(event.id)}">${event.pinned?'固定解除':'固定'}</button><button class="small danger" data-event-action="delete" data-event-id="${esc(event.id)}">削除</button>`:''}
        </div>
      </div>
      <div class="v59-side"><b>${esc(dText(event))}</b><small>${esc(looksMacroEvent(event)?'経済':(isCorporateEarnings(event)?'決算':'予定'))}</small></div>
    </div>`;
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
      決算は日付単位で折りたたみ表示します。時刻が公表されていない予定は日付のみを表示し、右側は24時間以内・残り日数で確認できます。今週は月曜〜日曜（日本時間）です。今週の発表済みも残ります。数値の「—」は未取得です。
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

let selectedPeriod='this';
window.renderEvents=function(){
  const root=document.getElementById('event-list');if(!root)return;
  const start=weekStart(),next=start+7*86400000,after=next+7*86400000;
  const rows=(state.events?.events||[]).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const periods={this:rows.filter(e=>Date.parse(e.time)>=start&&Date.parse(e.time)<next),next:rows.filter(e=>Date.parse(e.time)>=next&&Date.parse(e.time)<after),later:rows.filter(e=>Date.parse(e.time)>=after)};
  const old=rows.filter(e=>Date.parse(e.time)<start);
  const count=old.filter(e=>editable(e)&&!e.pinned).length;
  const clear=document.getElementById('event-clear-old');
  if(clear){clear.hidden=!count;clear.textContent='先週以前を整理（'+count+'件）';}
  root.innerHTML=`
    <div class="v59-toolbar"><button class="primary small" onclick="loadEvents(true)">決算予定を更新</button><span class="fresh">日本時間 · 日付タップで展開</span></div>
    ${coveragePanel(state.events?.coverage||{})}
    <div class="v59-periods" aria-label="イベントの期間">${[['this','今週'],['next','来週'],['later','今後']].map(([key,label])=>`<button data-event-period="${key}" aria-pressed="${selectedPeriod===key}">${label}（${periods[key].length}）</button>`).join('')}</div>
    ${section(({this:'今週',next:'来週',later:'今後'})[selectedPeriod],'重要日程',periods[selectedPeriod],'登録されたイベントはありません',window.innerWidth<=760?5:8,selectedPeriod==='this'?7:1)}
    ${old.length?`<details class="v59-details"><summary>先週以前・固定済み（${old.length}件）</summary>${groupedList(old,7,0)}</details>`:''}
    <p class="v59-note">今週分は整理対象に含みません。先週以前の手動イベントは整理できます。2週前以前の未固定イベントは一覧取得時に自動整理されます。予想比の矢印は数値の大小を示します。</p>`;
  root.onclick=event=>{
    const period=event.target.closest('[data-event-period]');if(period){selectedPeriod=period.dataset.eventPeriod;window.renderEvents();return;}
    const button=event.target.closest('[data-event-action]');if(!button)return;
    const id=button.dataset.eventId;
    if(button.dataset.eventAction==='edit')openResultsForm(id);
    if(button.dataset.eventAction==='pin')togglePin(id);
    if(button.dataset.eventAction==='delete')deleteEvent(id);
  };
  patchMoreIconFallback();
};
function resultInputs(event={}){
  return ['actual','forecast','previous','unit','source_url'].map((key,i)=>`<label>${['実績','予想','前回','単位（例：%、万人）','出典URL'][i]}<input id="ev-${key}" value="${esc(event[key]??'')}" maxlength="${key==='source_url'?2000:80}" ${key==='source_url'?'type="url"':''}></label>`).join('');
}
function formResults(){return Object.fromEntries(['actual','forecast','previous','unit','source_url'].map(key=>[key,document.getElementById('ev-'+key).value]));}
function openResultsForm(id){
  const event=(state.events?.events||[]).find(e=>e.id===id);if(!event||!editable(event))return;
  document.getElementById('modal-title').textContent=event.name+' · 数値';
  document.getElementById('modal-body').innerHTML='<div class="formgrid">'+resultInputs(event)+'<div class="span2 actions"><button id="ev-save-results" class="primary">保存</button></div></div>';
  document.getElementById('ev-save-results').onclick=async()=>{
    try{await api('/api/events',{method:'POST',body:{action:'update_results',id,...formResults()}});closeModal();await loadEvents();}catch(e){toast(e.message);}
  };openModal();
}
const originalOpenEventForm=window.openEventForm;
window.openEventForm=function(){
  originalOpenEventForm();
  const grid=document.querySelector('#modal-body .formgrid');
  grid.querySelector('.actions').insertAdjacentHTML('beforebegin',resultInputs());
};
window.addEvent=async function(){
  try{
    const symbols=document.getElementById('ev-symbols').value.split(/[、,\s]+/).map(x=>x.trim()).filter(Boolean);
    await api('/api/events',{method:'POST',body:{action:'add',name:document.getElementById('ev-name').value,time:new Date(document.getElementById('ev-time').value).toISOString(),category:document.getElementById('ev-cat').value,symbols,...formResults()}});
    closeModal();await loadEvents();
  }catch(e){toast(e.message);}
};

installStyle();
patchMoreIconFallback();
new MutationObserver(()=>patchMoreIconFallback()).observe(document.body,{childList:true,subtree:true});
if(typeof state!=='undefined'&&state.events?.events?.length)queueMicrotask(()=>window.renderEvents());
})();
(()=>{
'use strict';
const PATCH='v57-jpx-official-earnings-20260724';
if(window.__vantageV57Patch===PATCH)return;
window.__vantageV57Patch=PATCH;

function installStyle(){
  if(document.getElementById('v57-style'))return;
  const style=document.createElement('style');
  style.id='v57-style';
  style.textContent=`
    .v57-source-state{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:9px 0;font-size:11px;color:var(--muted,#667085)}
    .v57-source-state span{border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:5px 8px}
    .v57-source-state .ok{border-color:#93c5aa;color:#227447;background:#effaf3}
    .v57-source-state .warn{border-color:#e5bd75;color:#8a5b08;background:#fff8e8}
    .v57-source-badge{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:700}
    .v57-source-badge.jpx{background:#e8f3ff;color:#145da0}
    .v57-source-badge.ir{background:#edf8ef;color:#23733b}
    .v57-source-badge.provider{background:#fff6df;color:#8a5b08}
    .v57-source-badge.manual{background:#f1f2f4;color:#555}
    .v57-coverage-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
    @media(max-width:760px){.v57-coverage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function sourceMeta(event){
  const name=String(event.source_name||'');
  if(event.official_kind==='jpx'||name.startsWith('JPX'))return{label:'JPX公式',kind:'jpx'};
  if(event.source==='official')return{label:'企業IR',kind:'ir'};
  if(event.source==='provider')return{label:'Yahoo参考',kind:'provider'};
  return{label:'手動登録',kind:'manual'};
}

function rowHtml(event){
  const diff=new Date(event.time)-Date.now();
  const days=Math.ceil(diff/86400000);
  const symbols=(event.symbols||[]).map(code).join(' / ');
  const source=sourceMeta(event);
  return `<div class="row">${event.read_only?'':`<button class="small" aria-label="固定" title="固定" onclick="togglePin('${attr(event.id)}')">${icon('pin',15,event.pinned?'up':'')}</button>`}<div class="grow1"><div class="name">${esc(event.name)}</div><div class="event-time">${esc(eventTimeLabel(event))}</div>${symbols?`<div class="event-symbols">関連 ${esc(symbols)}</div>`:''}<span class="v57-source-badge ${source.kind}">${source.label}</span></div><div class="event-count">${diff>=0?(days<=1?'24h以内':days+'日'):'完了'}</div>${event.read_only?'':`<button class="small danger" aria-label="削除" title="削除" onclick="deleteEvent('${attr(event.id)}')">${icon('trash',15)}</button>`}</div>`;
}

function section(title,subtitle,rows,empty){
  return `<section class="v56-event-section"><div class="v56-event-section-head"><h3>${esc(title)}</h3><span>${esc(subtitle)} · ${rows.length}件</span></div><div class="card">${rows.length?rows.map(rowHtml).join(''):`<div class="empty">${esc(empty)}</div>`}</div></section>`;
}

function coverageHtml(c={}){
  const jp=c.by_market?.jp||{},us=c.by_market?.us||{},jpx=c.jpx||{};
  const missing=Number(c.not_listed_total??c.missing_total)||0;
  const missingRows=(c.missing_symbols||[]).slice(0,100);
  const uncheckedRows=(c.unchecked_symbols||[]).slice(0,100);
  const sourceClass=jpx.available&&!jpx.stale?'ok':'warn';
  const sourceText=jpx.available
    ?`JPX公式 ${jpx.event_count||0}件・${jpx.generated_at?dateText(jpx.generated_at):'更新時刻なし'}${jpx.stale?'（保存済み）':''}`
    :`JPX公式データ未取得${jpx.error?'・'+jpx.error:''}`;

  return `<div class="v56-event-coverage"><div class="v56-event-coverage-head"><b>登録対象の決算カバー状況</b><span class="fresh">${c.last_checked_at?`最終確認 ${dateText(c.last_checked_at)}`:'確認時刻なし'}</span></div><div class="v57-source-state"><span class="${sourceClass}">${esc(sourceText)}</span><span>日本 ${jp.found||0}/${jp.total||0}</span><span>米国 ${us.found||0}/${us.total||0}</span></div><div class="v57-coverage-grid"><div class="v56-coverage-kpi"><strong>${c.tracked_total||0}</strong><span>登録・監視対象</span></div><div class="v56-coverage-kpi"><strong>${c.jpx_found||0}</strong><span>JPX公式</span></div><div class="v56-coverage-kpi"><strong>${Math.max(0,(c.official_found||0)-(c.jpx_found||0))}</strong><span>企業IR確認</span></div><div class="v56-coverage-kpi"><strong>${c.provider_found||0}</strong><span>Yahoo参考</span></div><div class="v56-coverage-kpi"><strong>${missing}</strong><span>予定日未掲載</span></div><div class="v56-coverage-kpi"><strong>${c.unchecked_total||0}</strong><span>未確認</span></div></div><div class="v56-coverage-note">日本株はJPX無料公開資料を優先し、企業IR、Yahooの順で補完します。「予定日未掲載」は決算がない意味ではなく、現在の無料公開情報から予定日を確認できない状態です。</div>${missingRows.length?`<details><summary>予定日未掲載 ${missing}件</summary><div class="v56-missing-list">${missingRows.map(x=>`<span>${esc(code(x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div></details>`:''}${uncheckedRows.length?`<details><summary>まだ確認していない銘柄 ${c.unchecked_total||0}件</summary><div class="v56-missing-list">${uncheckedRows.map(x=>`<span>${esc(code(x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div></details>`:''}</div>`;
}

window.renderEvents=function(){
  const root=document.getElementById('event-list');if(!root)return;
  const now=Date.now(),ten=now+10*86400000,max=now+120*86400000;
  const events=(state.events?.events||[]).slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
  const future=events.filter(e=>{const t=new Date(e.time).getTime();return Number.isFinite(t)&&t>=now&&t<=max});
  const near=future.filter(e=>new Date(e.time).getTime()<=ten);
  const later=future.filter(e=>new Date(e.time).getTime()>ten);
  const earnings=later.filter(e=>e.category==='earnings');
  const general=later.filter(e=>e.category!=='earnings');
  const past=events.filter(e=>new Date(e.time).getTime()<now);

  let html=`<div class="toolbar"><button class="primary small" onclick="loadEvents(true)">決算予定を更新</button><span class="fresh">JPX公式＋企業IR＋Yahoo補完 / 120日</span></div>${coverageHtml(state.events?.coverage||{})}${section('直近10日の重要日程','決算・指標・手動登録を時系列表示',near,'直近10日に確認済みの日程はありません')}${section('決算予定','11〜120日先',earnings,'11〜120日先の取得済み決算予定はありません')}${section('通常イベント・経済指標','11〜120日先',general,'11〜120日先の通常イベント・指標はありません')}`;
  if(past.length)html+=`<details class="card"><summary class="row"><div class="name grow1">過去分</div><span class="count">${past.length}件</span></summary>${past.map(rowHtml).join('')}</details>`;
  root.innerHTML=html;
};

installStyle();
const version=document.querySelector('.ui-version');if(version)version.textContent='UI v57';
})();
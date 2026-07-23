(()=>{
'use strict';

const PATCH='v56-event-coverage-backtest-fix-20260724';
if(window.__vantageV56Patch===PATCH)return;
window.__vantageV56Patch=PATCH;

function installV56Style(){
  if(document.getElementById('v56-style'))return;
  const style=document.createElement('style');
  style.id='v56-style';
  style.textContent=`
    .v56-event-coverage{border:1px solid var(--line,#dfe3e8);border-radius:15px;padding:12px;margin:12px 0;background:var(--card,#fff)}
    .v56-event-coverage-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
    .v56-event-coverage-head b{flex:1}
    .v56-coverage-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
    .v56-coverage-kpi{border:1px solid var(--line,#dfe3e8);border-radius:12px;padding:10px}
    .v56-coverage-kpi strong{display:block;font-size:18px}
    .v56-coverage-kpi span{display:block;font-size:11px;color:var(--muted,#667085);margin-top:3px}
    .v56-coverage-note{font-size:11px;color:var(--muted,#667085);margin-top:9px;line-height:1.6}
    .v56-missing-list{display:flex;gap:6px;flex-wrap:wrap;padding-top:9px}
    .v56-missing-list span{font-size:11px;border:1px solid var(--line,#dfe3e8);border-radius:999px;padding:4px 7px}
    .v56-event-section{margin-top:14px}
    .v56-event-section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .v56-event-section-head h3{font-size:14px;margin:0;flex:1}
    .v56-event-section-head span{font-size:11px;color:var(--muted,#667085)}
    @media(max-width:760px){
      .v56-coverage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v56-coverage-kpi:last-child{grid-column:1/-1}
    }
  `;
  document.head.appendChild(style);
}

function v56EventSection(title,subtitle,rows,empty){
  return `
    <section class="v56-event-section">
      <div class="v56-event-section-head">
        <h3>${esc(title)}</h3>
        <span>${esc(subtitle)} · ${rows.length}件</span>
      </div>
      <div class="card">${rows.length?rows.map(eventRow).join(''):`<div class="empty">${esc(empty)}</div>`}</div>
    </section>
  `;
}

function v56CoverageHtml(coverage={}){
  const total=Number(coverage.tracked_total)||0;
  const checked=Number(coverage.checked_total)||0;
  const found=Number(coverage.earnings_found)||0;
  const missing=Number(coverage.missing_total)||0;
  const unchecked=Number(coverage.unchecked_total)||0;
  const jp=coverage.by_market?.jp||{};
  const us=coverage.by_market?.us||{};
  const missingRows=(coverage.missing_symbols||[]).slice(0,80);
  const uncheckedRows=(coverage.unchecked_symbols||[]).slice(0,80);

  return `
    <div class="v56-event-coverage">
      <div class="v56-event-coverage-head">
        <b>登録対象の決算カバー状況</b>
        <span class="fresh">${coverage.last_checked_at?`最終確認 ${dateText(coverage.last_checked_at)}`:'確認時刻なし'}</span>
      </div>
      <div class="v56-coverage-grid">
        <div class="v56-coverage-kpi"><strong>${total}</strong><span>登録・監視対象</span></div>
        <div class="v56-coverage-kpi"><strong>${checked}</strong><span>日程確認済み</span></div>
        <div class="v56-coverage-kpi"><strong>${found}</strong><span>決算予定取得</span></div>
        <div class="v56-coverage-kpi"><strong>${missing}</strong><span>確認済み・日程なし</span></div>
        <div class="v56-coverage-kpi"><strong>${unchecked}</strong><span>未確認</span></div>
      </div>
      <div class="v56-coverage-note">
        日本 ${jp.found||0}/${jp.total||0}件、米国 ${us.found||0}/${us.total||0}件。
        自動取得は無料提供元が返した次回決算予定です。日程なしは決算がない意味ではなく、提供元で予定日を取得できなかった状態です。
      </div>
      ${missingRows.length?`
        <details>
          <summary>日程を取得できなかった銘柄 ${missing}件</summary>
          <div class="v56-missing-list">${missingRows.map(x=>`<span>${esc(code(x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div>
        </details>`:''}
      ${uncheckedRows.length?`
        <details>
          <summary>まだ確認していない銘柄 ${unchecked}件</summary>
          <div class="v56-missing-list">${uncheckedRows.map(x=>`<span>${esc(code(x.symbol))} ${esc(x.name||'')}</span>`).join('')}</div>
        </details>`:''}
    </div>
  `;
}

window.renderEvents=function(){
  const root=document.getElementById('event-list');
  if(!root)return;

  const now=Date.now();
  const tenDays=now+10*86400000;
  const maxDays=now+120*86400000;
  const events=(state.events?.events||[])
    .slice()
    .sort((a,b)=>new Date(a.time)-new Date(b.time));

  const future=events.filter(event=>{
    const time=new Date(event.time).getTime();
    return Number.isFinite(time)&&time>=now&&time<=maxDays;
  });
  const near=future.filter(event=>new Date(event.time).getTime()<=tenDays);
  const later=future.filter(event=>new Date(event.time).getTime()>tenDays);
  const earnings=later.filter(event=>event.category==='earnings');
  const general=later.filter(event=>event.category!=='earnings');
  const past=events.filter(event=>new Date(event.time).getTime()<now);

  let html=`
    <div class="toolbar">
      <button class="primary small" onclick="loadEvents(true)">決算予定を更新</button>
      <span class="fresh">表示範囲 120日</span>
    </div>
    ${v56CoverageHtml(state.events?.coverage||{})}
    ${v56EventSection(
      '直近10日の重要日程',
      '決算・指標・手動登録を時系列表示',
      near,
      '直近10日に確認済みの日程はありません'
    )}
    ${v56EventSection(
      '決算予定',
      '11〜120日先',
      earnings,
      '11〜120日先の取得済み決算予定はありません'
    )}
    ${v56EventSection(
      '通常イベント・経済指標',
      '11〜120日先',
      general,
      '11〜120日先の通常イベント・指標はありません'
    )}
  `;

  if(past.length){
    html+=`
      <details class="card">
        <summary class="row">
          <div class="name grow1">過去分</div>
          <span class="count">${past.length}件</span>
        </summary>
        ${past.map(eventRow).join('')}
      </details>
    `;
  }

  root.innerHTML=html;
};

installV56Style();
const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v56';

})();
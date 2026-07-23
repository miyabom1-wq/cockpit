(()=>{
'use strict';

const PATCH='v55-simplified-workflow-20260724';
if(window.__vantageV55Patch===PATCH)return;
window.__vantageV55Patch=PATCH;

let internalNavigation=false;
let todayBusy=false;
let monitorBusy=false;

const qs=(s,r=document)=>r.querySelector(s);
const qsa=(s,r=document)=>[...r.querySelectorAll(s)];

function installStyle(){
  if(document.getElementById('v55-style'))return;
  const style=document.createElement('style');
  style.id='v55-style';
  style.textContent=`
    .theme-segment,.manage-segment{display:none!important}
    .v55-candidate-nav{display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap}
    .v55-candidate-nav .segment{margin:0;flex:1;min-width:210px}
    .v55-candidate-nav select{min-width:150px}
    .v55-overview{display:grid;gap:14px;margin-top:14px}
    .v55-section{background:var(--card,#fff);border:1px solid var(--line,#dfe3e8);border-radius:16px;overflow:hidden}
    .v55-section-head{display:flex;align-items:center;gap:10px;padding:14px 14px 10px}
    .v55-section-head h3{font-size:15px;margin:0;flex:1}
    .v55-section-head small{color:var(--muted,#667085)}
    .v55-section-body{padding:0 12px 12px}
    .v55-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
    .v55-kpi{border:1px solid var(--line,#dfe3e8);border-radius:13px;padding:11px;background:var(--card,#fff);cursor:pointer;text-align:left}
    .v55-kpi:hover{border-color:var(--accent,#2563eb)}
    .v55-kpi b{display:block;font-size:20px;line-height:1.2}
    .v55-kpi span{display:block;font-size:11px;color:var(--muted,#667085);margin-top:4px}
    .v55-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .v55-theme-card{border:1px solid var(--line,#dfe3e8);border-radius:13px;padding:11px;cursor:pointer}
    .v55-theme-card:hover{border-color:var(--accent,#2563eb)}
    .v55-theme-top{display:flex;align-items:center;gap:8px}
    .v55-theme-name{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
    .v55-theme-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted,#667085);margin-top:7px}
    .v55-candidate-list,.v55-event-list{display:grid;gap:7px}
    .v55-candidate-row,.v55-event-row{display:flex;align-items:center;gap:9px;border:1px solid var(--line,#dfe3e8);border-radius:12px;padding:10px;cursor:pointer}
    .v55-candidate-row:hover,.v55-event-row:hover{border-color:var(--accent,#2563eb)}
    .v55-candidate-main,.v55-event-main{min-width:0;flex:1}
    .v55-candidate-name,.v55-event-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .v55-candidate-meta,.v55-event-meta{font-size:11px;color:var(--muted,#667085);margin-top:3px;display:flex;gap:7px;flex-wrap:wrap}
    .v55-price{font-weight:700;white-space:nowrap}
    .v55-frame{width:30px;height:30px;border-radius:10px;padding:0;display:grid;place-items:center;font-weight:800}
    .v55-empty{padding:14px;text-align:center;color:var(--muted,#667085);font-size:12px}
    .v55-monitor-summary{margin-bottom:12px}
    .v55-context{display:none;align-items:center;gap:10px;margin:0 0 12px;padding:10px 12px;border:1px solid var(--line,#dfe3e8);border-radius:13px;background:var(--card,#fff)}
    .v55-context.show{display:flex}
    .v55-context b{flex:1}
    .v55-more-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .v55-more-group{border:1px solid var(--line,#dfe3e8);border-radius:15px;padding:12px}
    .v55-more-group h3{font-size:13px;margin:0 0 9px}
    .v55-more-actions{display:grid;gap:7px}
    .v55-more-actions button{text-align:left;justify-content:flex-start}
    .v55-more-actions small{display:block;color:var(--muted,#667085);font-weight:400;margin-top:2px}
    #v55-more-btn .v55-dots{font-size:21px;line-height:1;margin-top:-4px}
    .v55-hidden{display:none!important}
    @media(max-width:820px){
      .workflow-bar{display:none}
      .v55-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v55-kpi:last-child{grid-column:1/-1}
      .v55-theme-grid{grid-template-columns:1fr}
      .v55-more-grid{grid-template-columns:1fr}
      .v55-candidate-nav{align-items:stretch}
      .v55-candidate-nav .segment{width:100%}
      .v55-candidate-nav select{width:100%}
      #v55-more-btn .btn-label span:last-child{display:none}
    }
  `;
  document.head.appendChild(style);
}

function relabelShell(){
  const labels={stage:'今日',themes:'候補',watch:'監視'};
  for(const [tab,label] of Object.entries(labels)){
    const button=qs(`.tabs [data-tab="${tab}"]`);
    const span=button?.querySelector('span');
    if(span)span.textContent=label;
  }

  const stageNote=qs('#tab-stage .role-note');
  if(stageNote)stageNote.innerHTML='<b>今日</b><span>市場・重要日程・上位テーマ・有力候補を一画面で確認します。</span>';
  const themeNote=qs('#tab-themes .role-note');
  if(themeNote)themeNote.innerHTML='<b>候補</b><span>テーマから銘柄へ絞り、FRAMEへ送る候補を選びます。</span>';
  const watchNote=qs('#tab-watch .role-note');
  if(watchNote)watchNote.innerHTML='<b>監視</b><span>ウォッチ、保有、継続シグナル、イベント、需給警戒をまとめて確認します。</span>';

  const flow=qsa('.workflow-bar button');
  const flowData=[
    ['1','今日','地合いと日程','stage'],
    ['2','候補','テーマから銘柄へ','themes'],
    ['3','監視','保有と観察を確認','watch']
  ];
  flow.forEach((button,index)=>{
    const item=flowData[index];
    if(!item)return;
    const no=button.querySelector('.workflow-no');
    const title=button.querySelector('b');
    const small=button.querySelector('small');
    if(no)no.textContent=item[0];
    if(title)title.textContent=item[1];
    if(small)small.textContent=item[2];
    button.setAttribute('onclick',`switchTab('${item[3]}')`);
  });

  const footer=qs('footer');
  if(footer)footer.textContent='VANTAGE · Today / Candidates / Monitor';

  const version=qs('.ui-version');
  if(version)version.textContent='UI v55';
}

function ensureMoreButton(){
  if(document.getElementById('v55-more-btn'))return;
  const actions=qs('.header-actions');
  if(!actions)return;
  const settings=qsa('button',actions).find(button=>String(button.getAttribute('onclick')||'').includes('openSettings'));
  const button=document.createElement('button');
  button.id='v55-more-btn';
  button.className='iconbtn';
  button.type='button';
  button.title='その他';
  button.setAttribute('aria-label','その他');
  button.setAttribute('onclick','openV55More()');
  button.innerHTML='<span class="btn-label"><span class="v55-dots" aria-hidden="true">•••</span><span>その他</span></span>';
  actions.insertBefore(button,settings||null);
}

function ensureCandidateNav(){
  if(document.getElementById('v55-candidate-nav'))return;
  const old=qs('#tab-themes .theme-segment');
  if(!old)return;

  const nav=document.createElement('div');
  nav.id='v55-candidate-nav';
  nav.className='v55-candidate-nav';
  nav.innerHTML=`
    <div class="segment grow">
      <button id="v55-theme-mode" class="active" onclick="setV55CandidateMode('theme')">テーマ</button>
      <button id="v55-stock-mode" onclick="setV55CandidateMode('stocks')">銘柄</button>
    </div>
    <select id="v55-candidate-sort" onchange="setV55CandidateSort(this.value)" aria-label="銘柄の並び順">
      <option value="lane">判定順</option>
      <option value="score">総合点順</option>
    </select>
  `;
  old.insertAdjacentElement('afterend',nav);
}

function ensureWatchShell(){
  const panel=document.getElementById('tab-watch');
  if(!panel)return;

  if(!document.getElementById('v55-context')){
    const context=document.createElement('div');
    context.id='v55-context';
    context.className='v55-context';
    context.innerHTML='<button class="small" onclick="returnToV55Monitor()">← 監視へ戻る</button><b id="v55-context-title">詳細</b>';
    const note=panel.querySelector('.role-note');
    note?.insertAdjacentElement('afterend',context);
  }

  if(!document.getElementById('v55-monitor-summary')){
    const summary=document.createElement('div');
    summary.id='v55-monitor-summary';
    summary.className='v55-monitor-summary';
    const listView=document.getElementById('watch-list-view');
    listView?.insertAdjacentElement('beforebegin',summary);
  }
}

function currentCandidateMode(){
  return document.getElementById('v55-stock-mode')?.classList.contains('active')?'stocks':'theme';
}

function syncCandidateNav(view){
  const theme=document.getElementById('v55-theme-mode');
  const stocks=document.getElementById('v55-stock-mode');
  const sort=document.getElementById('v55-candidate-sort');
  if(!theme||!stocks||!sort)return;

  const isTheme=view==='radar';
  const isStock=['board','ranking'].includes(view);
  theme.classList.toggle('active',isTheme);
  stocks.classList.toggle('active',isStock);
  sort.classList.toggle('v55-hidden',!isStock);
  if(view==='ranking')sort.value='score';
  else if(view==='board')sort.value='lane';
}

window.setV55CandidateMode=function(mode){
  if(mode==='theme'){
    setThemeView('radar');
    return;
  }
  const sort=document.getElementById('v55-candidate-sort')?.value||'lane';
  setThemeView(sort==='score'?'ranking':'board');
};

window.setV55CandidateSort=function(mode){
  setThemeView(mode==='score'?'ranking':'board');
};

function setWatchContext(view){
  const context=document.getElementById('v55-context');
  const title=document.getElementById('v55-context-title');
  const note=qs('#tab-watch .role-note');
  const labels={
    signals:['実績・シグナル','シグナルの継続、脱落、5日観測結果を確認します。'],
    backtest:['実績・バックテスト','登録銘柄全体の長期検証と失敗状況を確認します。'],
    events:['データ管理・イベント','自動取得、公式確認、手動登録の日程を管理します。'],
    universe:['分析対象','登録銘柄、固定銘柄、入れ替え候補を管理します。'],
    margin:['データ管理・信用需給','週次信用残と注意・規制情報の同期状態を確認します。']
  };

  if(view==='list'){
    context?.classList.remove('show');
    if(note)note.innerHTML='<b>監視</b><span>ウォッチ、保有、継続シグナル、イベント、需給警戒をまとめて確認します。</span>';
    return;
  }

  const item=labels[view]||['詳細','管理情報を確認します。'];
  if(title)title.textContent=item[0];
  context?.classList.add('show');
  if(note)note.innerHTML=`<b>${esc(item[0])}</b><span>${esc(item[1])}</span>`;
}

window.returnToV55Monitor=function(){
  internalNavigation=true;
  try{
    setWatchView('list');
  }finally{
    internalNavigation=false;
  }
};

window.openV55Area=function(view){
  closeModal();
  if(view==='settings'){
    openSettings();
    return;
  }
  if(view==='discover'){
    internalNavigation=true;
    try{
      switchTab('themes');
      setThemeScope('jp');
      setThemeView('discover');
    }finally{
      internalNavigation=false;
    }
    return;
  }

  internalNavigation=true;
  try{
    switchTab('watch');
    setWatchView(view);
  }finally{
    internalNavigation=false;
  }
};

window.openV55More=function(){
  const body=document.getElementById('modal-body');
  const title=document.getElementById('modal-title');
  if(!body||!title)return;
  title.textContent='その他';
  body.innerHTML=`
    <div class="v55-more-grid">
      <section class="v55-more-group">
        <h3>実績</h3>
        <div class="v55-more-actions">
          <button onclick="openV55Area('signals')"><b>シグナル実績</b><small>継続・脱落・5日観測</small></button>
          <button onclick="openV55Area('backtest')"><b>長期バックテスト</b><small>全登録銘柄の検証</small></button>
        </div>
      </section>
      <section class="v55-more-group">
        <h3>分析対象</h3>
        <div class="v55-more-actions">
          <button onclick="openV55Area('universe')"><b>登録銘柄</b><small>固定・入れ替え・対象数</small></button>
          <button onclick="openV55Area('discover')"><b>新規探索</b><small>日本株の未登録候補</small></button>
        </div>
      </section>
      <section class="v55-more-group">
        <h3>データ管理</h3>
        <div class="v55-more-actions">
          <button onclick="openV55Area('events')"><b>イベント</b><small>決算予定と手動日程</small></button>
          <button onclick="openV55Area('margin')"><b>信用需給</b><small>週次データと規制情報</small></button>
        </div>
      </section>
      <section class="v55-more-group">
        <h3>設定</h3>
        <div class="v55-more-actions">
          <button onclick="openV55Area('settings')"><b>設定・システム状態</b><small>再計算、通知、接続確認</small></button>
          <button onclick="closeModal();openGuide()"><b>使い方</b><small>VANTAGEの基本手順</small></button>
        </div>
      </section>
    </div>
  `;
  openModal();
};

function flattenBoard(momentum,lanes=['A','B']){
  const out=[];
  for(const lane of momentum?.board||[]){
    if(!lanes.includes(lane.key))continue;
    for(const row of lane.rows||[])out.push(row);
  }
  return out;
}

function eventRows(events){
  const now=Date.now();
  const limit=now+10*86400000;
  return (events?.events||[])
    .filter(event=>{
      const time=new Date(event.time).getTime();
      return Number.isFinite(time)&&time>=now&&time<=limit;
    })
    .sort((a,b)=>new Date(a.time)-new Date(b.time));
}

function themeLeaders(jp,us){
  if(typeof themeName!=='function'||typeof balancedThemePhase!=='function')return[];
  const groups=new Map();
  const add=(row,market)=>{
    const name=themeName(row);
    if(!groups.has(name))groups.set(name,{jp:[],us:[]});
    groups.get(name)[market].push(row);
  };
  for(const row of jp?.rows||[])add(row,'jp');
  for(const row of us?.rows||[])add(row,'us');

  return [...groups].map(([name,group])=>({
    name,
    phase:balancedThemePhase(group.jp,group.us)
  }))
    .filter(item=>item.phase&&item.phase.code!=='WAIT')
    .sort((a,b)=>{
      const pa=typeof themePriority==='function'?themePriority(a.phase.code):9;
      const pb=typeof themePriority==='function'?themePriority(b.phase.code):9;
      return pa-pb||(Number(b.phase.rs5)||-99)-(Number(a.phase.rs5)||-99);
    })
    .slice(0,3);
}

function compactCandidate(row){
  const market=marketOf(row.symbol);
  const price=quoteFinite(row.price)
    ?market==='jp'?`${num(row.price,0)}円`:`$${num(row.price,2)}`
    :'—';
  return `
    <div class="v55-candidate-row" onclick="openCandidate('${attr(row.symbol)}')">
      <span class="badge ${attr(row.entry_lane||'D')}">${esc(row.entry_quality||row.entry_lane||'D')}</span>
      <div class="v55-candidate-main">
        <div class="v55-candidate-name">${esc(row.name||row.symbol)} <span class="code">${esc(code(row.symbol))}</span></div>
        <div class="v55-candidate-meta">
          <span>RS5 ${pct(row.rs5)}</span>
          <span>出来高 ${num(row.effective_vol_ratio??row.vol_ratio)}x</span>
          ${market==='jp'&&row.margin_supply?`<span>${esc(row.margin_supply.label||'需給')}</span>`:''}
        </div>
      </div>
      <span class="v55-price">${price}</span>
      <button class="v55-frame" onclick="event.stopPropagation();openFrame('${attr(row.symbol)}','${attr(row.name||row.symbol)}','${market}','today')" title="FRAMEで判定">F</button>
    </div>
  `;
}

function compactEvent(event){
  const symbols=(event.symbols||[]).map(code).join(' / ');
  return `
    <div class="v55-event-row" onclick="openV55Area('events')">
      <span class="badge C">${esc(event.category==='earnings'?'決算':'日程')}</span>
      <div class="v55-event-main">
        <div class="v55-event-name">${esc(event.name)}</div>
        <div class="v55-event-meta"><span>${esc(eventTimeLabel(event))}</span>${symbols?`<span>${esc(symbols)}</span>`:''}</div>
      </div>
    </div>
  `;
}

async function renderTodayOverview(){
  const root=document.getElementById('v55-today-overview');
  if(!root||todayBusy)return;
  todayBusy=true;
  root.innerHTML='<div class="loading">今日の確認項目を集約中…</div>';

  try{
    const [events,jp,us]=await Promise.all([
      state.events?Promise.resolve(state.events):api('/api/events').catch(()=>({events:[]})),
      state.momentum.jp?Promise.resolve(state.momentum.jp):api('/api/momentum?market=jp').catch(()=>null),
      state.momentum.us?Promise.resolve(state.momentum.us):api('/api/momentum?market=us').catch(()=>null)
    ]);

    if(jp)state.momentum.jp=jp;
    if(us)state.momentum.us=us;
    state.events=events;

    const current=state.market==='us'?us:jp;
    const candidates=flattenBoard(current,['A','B'])
      .sort((a,b)=>(Number(b.entry_score)||0)-(Number(a.entry_score)||0))
      .slice(0,5);
    const themes=themeLeaders(jp,us);
    const near=eventRows(events).slice(0,5);

    root.innerHTML=`
      <div class="v55-overview">
        <section class="v55-section">
          <div class="v55-section-head">
            <h3>上位テーマ</h3>
            <small>日米横断</small>
            <button class="small" onclick="switchTab('themes');setV55CandidateMode('theme')">すべて見る</button>
          </div>
          <div class="v55-section-body">
            ${themes.length?`<div class="v55-theme-grid">${themes.map(item=>`
              <div class="v55-theme-card" onclick="switchTab('themes');setV55CandidateMode('theme')">
                <div class="v55-theme-top"><span class="v55-theme-name">${esc(item.name)}</span>${phaseBadge(item.phase)}</div>
                <div class="v55-theme-meta">
                  <span>RS5 ${pct(item.phase.rs5)}</span>
                  <span>${esc(item.phase.propagation||'判定待ち')}</span>
                  <span>確度 ${item.phase.confidence||0}%</span>
                </div>
              </div>`).join('')}</div>`:'<div class="v55-empty">明確な上位テーマはありません。</div>'}
          </div>
        </section>

        <section class="v55-section">
          <div class="v55-section-head">
            <h3>${state.market==='jp'?'日本株':'米国株'} A・B候補</h3>
            <small>上位5件</small>
            <button class="small primary" onclick="switchTab('themes');setThemeScope('${state.market}');setV55CandidateMode('stocks')">候補をすべて見る</button>
          </div>
          <div class="v55-section-body">
            ${candidates.length?`<div class="v55-candidate-list">${candidates.map(compactCandidate).join('')}</div>`:'<div class="v55-empty">現在のA・B候補はありません。</div>'}
          </div>
        </section>

        <section class="v55-section">
          <div class="v55-section-head">
            <h3>10日以内の重要日程</h3>
            <small>決算・手動・公式確認</small>
            <button class="small" onclick="openV55Area('events')">イベント管理</button>
          </div>
          <div class="v55-section-body">
            ${near.length?`<div class="v55-event-list">${near.map(compactEvent).join('')}</div>`:'<div class="v55-empty">確認済みの日程はありません。未取得を意味する場合があります。</div>'}
          </div>
        </section>
      </div>
    `;
  }catch(error){
    root.innerHTML=`<div class="note down">今日の集約表示に失敗しました：${esc(error.message)}</div>`;
  }finally{
    todayBusy=false;
  }
}

async function renderMonitorSummary(){
  const root=document.getElementById('v55-monitor-summary');
  if(!root||monitorBusy||state.watchView!=='list')return;
  monitorBusy=true;
  root.innerHTML='<div class="loading compact">監視状況を集約中…</div>';

  try{
    const [watch,signals,events,positions,jpStage]=await Promise.all([
      state.watch?Promise.resolve(state.watch):api('/api/watchlist').catch(()=>({items:[]})),
      state.signals?Promise.resolve(state.signals):api('/api/signal-log?limit=80').catch(()=>({items:[]})),
      state.events?Promise.resolve(state.events):api('/api/events').catch(()=>({events:[]})),
      state.positions?Promise.resolve(state.positions):api('/api/positions').catch(()=>({positions:[]})),
      state.stage.jp?Promise.resolve(state.stage.jp):api('/api/stage?market=jp').catch(()=>({stocks:{}}))
    ]);

    state.watch=watch;
    state.signals=signals;
    state.events=events;
    state.positions=positions;
    state.stage.jp=jpStage;

    const signalItems=signals.items||signals.signals||signals.records||[];
    const activeSignals=signalItems.filter(item=>item.active!==false&&!item.end_date&&!item.completed_at).length;
    const nearEvents=eventRows(events).length;
    const marginWarnings=Object.values(jpStage.stocks||{}).filter(row=>
      row.margin_add_blocked||Number(row.supply_score??row.margin_supply?.score)<=-7
    ).length;

    root.innerHTML=`
      <div class="v55-kpi-grid">
        <button class="v55-kpi" onclick="returnToV55Monitor()"><b>${(watch.items||[]).length}</b><span>ウォッチ</span></button>
        <button class="v55-kpi" onclick="returnToV55Monitor()"><b>${(positions.positions||[]).length}</b><span>実保有</span></button>
        <button class="v55-kpi" onclick="openV55Area('signals')"><b>${activeSignals}</b><span>継続シグナル</span></button>
        <button class="v55-kpi" onclick="openV55Area('events')"><b>${nearEvents}</b><span>10日以内イベント</span></button>
        <button class="v55-kpi" onclick="openV55Area('margin')"><b>${marginWarnings}</b><span>信用需給警戒</span></button>
      </div>
    `;
  }catch(error){
    root.innerHTML=`<div class="note down">監視状況の集約に失敗しました：${esc(error.message)}</div>`;
  }finally{
    monitorBusy=false;
  }
}

function ensureTodayRoot(){
  if(document.getElementById('v55-today-overview'))return;
  const stage=document.getElementById('stage-summary');
  if(!stage)return;
  const root=document.createElement('div');
  root.id='v55-today-overview';
  stage.insertAdjacentElement('afterend',root);
}

function installWrappers(){
  const originalSwitchTab=window.switchTab;
  if(typeof originalSwitchTab==='function'){
    window.switchTab=function(tab){
      if(tab==='watch'&&!internalNavigation)state.watchView='list';
      const out=originalSwitchTab.apply(this,arguments);
      if(tab==='watch')setTimeout(()=>{
        setWatchContext(state.watchView);
        if(state.watchView==='list')renderMonitorSummary();
      },0);
      if(tab==='stage')setTimeout(renderTodayOverview,0);
      return out;
    };
  }

  const originalSetThemeView=window.setThemeView;
  if(typeof originalSetThemeView==='function'){
    window.setThemeView=function(view){
      const out=originalSetThemeView.apply(this,arguments);
      syncCandidateNav(view);
      return out;
    };
  }

  const originalSetWatchView=window.setWatchView;
  if(typeof originalSetWatchView==='function'){
    window.setWatchView=function(view){
      const out=originalSetWatchView.apply(this,arguments);
      setWatchContext(state.watchView);
      if(state.watchView==='list')setTimeout(renderMonitorSummary,0);
      return out;
    };
  }

  const originalLoadStage=window.loadStage;
  if(typeof originalLoadStage==='function'){
    window.loadStage=async function(){
      const out=await originalLoadStage.apply(this,arguments);
      if(state.tab==='stage')await renderTodayOverview();
      return out;
    };
  }

  const originalLoadWatch=window.loadWatch;
  if(typeof originalLoadWatch==='function'){
    window.loadWatch=async function(){
      const out=await originalLoadWatch.apply(this,arguments);
      if(state.tab==='watch'&&state.watchView==='list')await renderMonitorSummary();
      return out;
    };
  }
}

function boot(){
  installStyle();
  relabelShell();
  ensureMoreButton();
  ensureCandidateNav();
  ensureWatchShell();
  ensureTodayRoot();
  installWrappers();
  syncCandidateNav(state.themeView||'radar');
  setWatchContext(state.watchView||'list');
  setTimeout(()=>{
    if(state.tab==='stage')renderTodayOverview();
    if(state.tab==='watch'&&state.watchView==='list')renderMonitorSummary();
  },400);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();

})();
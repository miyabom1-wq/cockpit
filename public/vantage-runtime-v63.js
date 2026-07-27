/* vantage-stable-v63-20260726 - frozen UI runtime */
/* vantage-frame-sync-v49.js */
(()=>{
  const FRAME_DEFAULT_API='https://frame-backend.miyab.workers.dev';
  const STATUS_LABEL={UNSET:'未設定',WAIT:'WAIT',READY:'READY',TRIGGERED:'TRIGGERED',INVALID:'INVALID'};
  const TEMPLATE_LABEL={unset:'条件未設定',reacceleration:'再加速待ち',reversal:'反転確認待ち',pullback_complete:'押し目完了待ち'};
  let syncBusy=false,lastSyncError='';
  state.frameSync=state.frameSync||{};

  const style=document.createElement('style');
  style.id='vantage-frame-sync-v49-style';
  style.textContent=`
    .ai-copy-button{min-width:112px}.ai-copy-button .btn-label{display:inline-flex;align-items:center;gap:6px}.ai-copy-button .ui-icon{width:16px;height:16px}
    .frame-sync-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #d8e1ea;border-radius:999px;padding:4px 8px;background:#f2f5f8;color:#536174;font-size:9px;font-weight:800;white-space:nowrap;cursor:pointer}.frame-sync-chip b{font:900 10px var(--mono)}.frame-sync-chip.UNSET{background:#f0eafa;color:#6a52a1;border-color:#ddd1f0}.frame-sync-chip.WAIT{background:#fff0d4;color:#956200;border-color:#efdcae}.frame-sync-chip.READY{background:#e1ebff;color:#245fc2;border-color:#cbdaf7}.frame-sync-chip.TRIGGERED{background:#dff3e9;color:#157a50;border-color:#c4e5d5}.frame-sync-chip.INVALID{background:#fde3e7;color:#b4253f;border-color:#f1c9d0}.frame-sync-chip.ERROR{background:#f2f3f5;color:#7c8794}
    .frame-sync-note{font-size:9px;color:var(--faint);margin-top:4px}
    @media(max-width:720px){.clock{display:none}.ai-copy-button{width:38px;min-width:38px;padding:0}.ai-copy-button .ai-copy-label{display:none}.header-actions{gap:5px}.frame-sync-chip{padding:4px 7px}.frame-sync-chip span{display:none}}
  `;
  document.head.appendChild(style);

  function frameApiBase(){return localStorage.getItem('frame_api')||FRAME_DEFAULT_API;}
  function frameHeaders(){const h={'Content-Type':'application/json'},k=localStorage.getItem('frame_write_key');if(k)h['X-Frame-Key']=k;return h;}
  function templateFor(lane,source){if(String(source||'').toLowerCase()==='manual')return'unset';const l=String(lane||'').toUpperCase();if(l==='A')return'reacceleration';if(l==='B')return'reversal';if(l==='C')return'pullback_complete';return'unset';}
  function frameStatus(symbol){return state.frameSync?.[String(symbol||'').toUpperCase()]||null;}

  function watchSyncItem(w,bm){
    const r=typeof currentWatchData==='function'?currentWatchData(w,bm):(w.current_data||w.stage_data||{}),key=String(w.symbol||'').toUpperCase(),m=w.market||marketOf(key),lane=r.entry_lane||w.signal_snapshot?.entry_lane||'',ctx=typeof frameContextFor==='function'?frameContextFor(r):{};
    const flags=r.margin_supply?.flags||{};
    return{
      watch_id:w.id,symbol:key,market:m,name:w.name||r.name||key,source:w.source||'watch',watch_status:w.status||'tracking',memo:w.memo||'',lane,template:templateFor(lane,w.source),
      source_context:{source:'VANTAGE',market:m,symbol:key,name:w.name||r.name||key,theme:ctx.theme||'',theme_phase:ctx.theme_phase||'',theme_code:ctx.theme_code||'',propagation:ctx.propagation||'',lane,lane_label:r.entry_label||r.entry_quality||'',risk:ctx.risk||'',scope:ctx.scope||'',from:'watch',setup:r.setup_label||'',trade_date:state.stage?.[m]?.trade_date||'',rs5:r.rs5,rs20:r.rs20,vol_ratio:r.effective_vol_ratio??r.vol_ratio,price:r.price,change_pct:r.change_pct,price_time:r.price_time||'',quote_state:typeof quoteTimeText==='function'?quoteTimeText(r,m):'',supply_label:r.supply_label||'',supply_score:r.supply_score,margin_ratio:r.margin_ratio,margin_buy:r.margin_buy_balance,margin_sell:r.margin_sell_balance,margin_buy_change_pct:r.margin_buy_change_pct,margin_turnover_days:r.margin_turnover_days,margin_as_of:r.margin_as_of||'',margin_summary:r.margin_supply?.summary||'',margin_flags:flags,margin_add_blocked:!!r.margin_add_blocked}
    };
  }

  async function syncFrameWatchlist(watchData=state.watch,{silent=true}={}){
    if(syncBusy)return null;syncBusy=true;
    try{
      let data=watchData;
      if(!data?.items)data=await api('/api/watchlist');
      state.watch=data;
      const bm=typeof boardMap==='function'?boardMap():new Map(),items=(data.items||[]).map(w=>watchSyncItem(w,bm));
      const response=await fetch(frameApiBase()+'/api/plans',{method:'POST',headers:frameHeaders(),body:JSON.stringify({action:'sync_vantage',schema:'vantage-watch-sync-v1',items})});
      let payload={};try{payload=await response.json()}catch{}
      if(!response.ok)throw new Error(payload.error||`FRAME API ${response.status}`);
      state.frameSync=payload.statuses||{};lastSyncError='';decorateWatchCards();
      if(!silent)toast(`FRAME同期 ${payload.linked??items.length}件`);
      return payload;
    }catch(e){lastSyncError=e?.message||String(e);decorateWatchCards();if(!silent)toast('FRAME同期失敗: '+lastSyncError);return null}
    finally{syncBusy=false}
  }
  window.syncFrameWatchlist=syncFrameWatchlist;

  function symbolFromFrameButton(row){const b=row.querySelector('button[onclick*="openFrame("]');if(!b)return'';const m=String(b.getAttribute('onclick')||'').match(/openFrame\('([^']+)'/);return m?m[1].toUpperCase():'';}
  function decorateWatchCards(){
    const root=document.getElementById('watch-list');if(!root)return;
    for(const row of root.querySelectorAll('details.compact-row')){
      const symbol=symbolFromFrameButton(row);if(!symbol)continue;
      const head=row.querySelector('summary.compact-head'),frameButton=row.querySelector('button.frame-action[onclick*="openFrame("]');if(!head||!frameButton)continue;
      let chip=head.querySelector('.frame-sync-chip');if(!chip){chip=document.createElement('button');chip.type='button';chip.className='frame-sync-chip';chip.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();frameButton.click()});const quote=head.querySelector('.watch-quote');head.insertBefore(chip,quote||null)}
      const s=frameStatus(symbol),status=s?.status||'',label=STATUS_LABEL[status]||status;
      chip.className='frame-sync-chip '+(status||'ERROR');
      if(s){chip.innerHTML=`<span>FRAME</span><b>${label}</b>`;chip.title=`FRAME：${label} / ${TEMPLATE_LABEL[s.template]||s.template_label||''}`;}
      else{chip.innerHTML=`<span>FRAME</span><b>${lastSyncError?'接続待ち':'同期中'}</b>`;chip.title=lastSyncError||'FRAMEへ同期しています';}
      frameButton.textContent=s?.configured?'FRAMEを開く':'FRAMEで条件設定';
    }
  }
  window.decorateWatchCards=decorateWatchCards;

  const originalRender=window.renderWatch;
  if(typeof originalRender==='function')window.renderWatch=function(...args){const result=originalRender.apply(this,args);queueMicrotask(decorateWatchCards);return result;};
  const originalLoad=window.loadWatch;
  if(typeof originalLoad==='function')window.loadWatch=async function(...args){const result=await originalLoad.apply(this,args);await syncFrameWatchlist(state.watch,{silent:true});decorateWatchCards();return result;};

  const version=document.querySelector('.ui-version');if(version)version.textContent='UI v51';
  setTimeout(()=>syncFrameWatchlist(state.watch,{silent:true}),800);
  setInterval(()=>{if(!document.hidden)syncFrameWatchlist(state.watch,{silent:true})},10*60*1000);
  addEventListener('visibilitychange',()=>{if(!document.hidden)syncFrameWatchlist(state.watch,{silent:true})});
})();

/* reliability-fixes-v53.js */
(()=>{
const PATCH='v53-reliability-sync-20260723';
if(window.__vantageReliabilityPatch===PATCH)return;
window.__vantageReliabilityPatch=PATCH;

const baseRenderEvents=window.renderEvents;
window.renderEvents=function(){
  const out=typeof baseRenderEvents==='function'?baseRenderEvents.apply(this,arguments):undefined;
  const root=document.getElementById('event-list');
  if(root){
    const fresh=root.querySelector('.toolbar .fresh');
    if(fresh)fresh.textContent='登録銘柄＋ウォッチ＋シグナルを分割同期';
    const warning=root.querySelector('.coverage-warning');
    if(warning)warning.innerHTML='<b>公式確認＋自動取得＋手動登録</b>：登録銘柄、ウォッチ、シグナル履歴を対象にします。通信上限を守るため20銘柄ずつ分割し、「決算予定を更新」1回で全バッチを順番に確認します。自動取得は参考日程のため、売買前に企業IR・証券会社で時刻を確認してください。';
  }
  return out;
};

window.loadEvents=async function(force=false){
  const root=document.getElementById('event-list');if(!root)return;
  root.innerHTML='<div class="loading">決算予定を取得中…</div>';
  try{
    if(force){
      let progress=await api('/api/events-sync',{method:'POST',body:{batch:0}});
      const total=Math.max(1,Number(progress.batch_count)||1);
      for(let batch=1;batch<total;batch++){
        root.innerHTML=`<div class="loading">登録銘柄の決算予定を更新中… ${batch+1}/${total}</div>`;
        progress=await api('/api/events-sync',{method:'POST',body:{batch}});
      }
      toast(`決算予定を全${progress.total||0}銘柄で確認しました`);
    }
    state.events=await api('/api/events');
    renderEvents();
  }catch(e){
    root.innerHTML='<div class="card pad down">'+esc(e.message)+'</div>';
  }
};

window.applyUniverse=async function(force=false){
  const message=force?'安全履歴ゲートを今回だけ解除して提案を適用します。保有・ウォッチ・固定銘柄は保護されます。よろしいですか？':'安全条件を満たした提案だけを適用します。よろしいですか？';
  if(!confirm(message))return;
  try{
    const d=await api('/api/universe',{method:'POST',body:{action:'apply',force}});
    if(d.ok===false)throw new Error(d.error||'適用できる変更はありません');
    const applied=d.applied||[],detail=applied.map(x=>`${x.market.toUpperCase()} +${x.adds?.length||0}/-${x.drops?.length||0}`).join(' / ');
    if(detail)toast('入れ替え完了 '+detail);
    else if(d.stale_proposal_cleared)toast('古い提案を消去しました。提案を更新してください');
    else toast('変更はありません');
    await loadUniverse();
  }catch(e){
    toast('適用されませんでした: '+e.message);
    await loadUniverse();
  }
};

const baseLoadMargin=window.loadMarginSupply;
if(typeof baseLoadMargin==='function')window.loadMarginSupply=async function(force=false){
  const out=await baseLoadMargin.apply(this,arguments);
  if(force&&state.margin?.weekly?.as_of)toast(`信用需給を${state.margin.weekly.as_of}基準へ同期しました`);
  return out;
};

const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v53';
})();

/* reliability-fixes-v54.js */
(()=>{
'use strict';
const PATCH='v54-events-backtest-resilience-20260724';
if(window.__vantageV54Patch===PATCH)return;
window.__vantageV54Patch=PATCH;

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function syncEventBatch(batch){
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      return await api('/api/events-sync',{
        method:'POST',
        body:{batch,batch_size:10}
      });
    }catch(error){
      last=error;
      if(attempt<3)await wait(700*attempt);
    }
  }
  throw last||new Error('決算予定の同期に失敗しました');
}

window.loadEvents=async function(force=false){
  const root=document.getElementById('event-list');
  if(!root)return;
  root.innerHTML='<div class="loading">決算予定を取得中…</div>';

  let syncError=null;
  let processed=0;
  let found=0;
  let total=0;

  try{
    if(force){
      let batch=0;
      let batchCount=1;

      while(batch<batchCount){
        root.innerHTML=`<div class="loading">登録銘柄の決算予定を更新中… ${batch+1}/${batchCount}</div>`;
        try{
          const progress=await syncEventBatch(batch);
          batchCount=Math.max(1,Number(progress.batch_count)||1);
          total=Math.max(total,Number(progress.total)||0);
          processed+=Number(progress.processed)||0;
          found+=Number(progress.found)||0;
          batch++;
        }catch(error){
          syncError=error;
          break;
        }
      }
    }

    state.events=await api('/api/events');
    renderEvents();

    if(syncError){
      const note=document.createElement('div');
      note.className='note down';
      note.innerHTML=`<b>一部同期に失敗：</b>${esc(syncError.message)}。取得済みの日程は表示しています。`;
      root.prepend(note);
      toast(`決算予定は${processed}/${total||processed}銘柄まで更新`);
    }else if(force){
      toast(`決算予定を${processed}/${total}銘柄確認・${found}件取得`);
    }
  }catch(error){
    try{
      state.events=await api('/api/events');
      renderEvents();
      const note=document.createElement('div');
      note.className='note down';
      note.innerHTML=`<b>更新失敗：</b>${esc(error.message)}。保存済みの日程を表示しています。`;
      root.prepend(note);
    }catch{
      root.innerHTML='<div class="card pad down">'+esc(error.message)+'</div>';
    }
  }
};

const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v54';
})();

/* navigation-v55.js */
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

/* event-coverage-v56.js */
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

/* event-official-v57.js */
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

/* event-mobile-v58.js */
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

/* event-mobile-v59.js */
(()=>{
'use strict';
const PATCH='v62-home-event-date-20260726';
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
  const date=shortDate(event?.time);
  const note=String(event?.time_note||'').trim();
  const cleaned=note
    .replace(/^\d{1,2}\/\d{1,2}\s*(?:[\u30fb\u00b7-]\s*)?/,'')
    .replace(/(?:\u6642\u523b\u672a\u78ba\u8a8d|\u6642\u523b\u672a\u516c\u8868|\u6642\u9593\u672a\u516c\u8868)/g,'')
    .replace(/^[\s\u30fb\u00b7-]+|[\s\u30fb\u00b7-]+$/g,'')
    .trim();

  if(cleaned)return date?date+' \u30fb '+cleaned:cleaned;

  const source=srcInfo(event);
  if(source.cls==='jpx')return date?date+' \u30fb \u6642\u9593\u672a\u516c\u8868':'\u6642\u9593\u672a\u516c\u8868';
  if(source.cls==='provider')return date?date+' \u30fb \u53c2\u8003\u65e5\u7a0b':'\u53c2\u8003\u65e5\u7a0b';
  return date;
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
if(typeof state!=='undefined'&&state.events?.events?.length)queueMicrotask(()=>window.renderEvents());
const version=document.querySelector('.ui-version');
if(version)version.textContent='UI v62';
})();

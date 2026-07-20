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

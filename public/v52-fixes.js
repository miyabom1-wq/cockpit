(()=>{
'use strict';

const VERSION='v52-usability-20260721';
const hasJapanese=v=>/[ぁ-んァ-ヶ一-龠々]/.test(String(v||''));
const upper=v=>String(v||'').trim().toUpperCase();
const safeId=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'_');

function collectRows(){
  const rows=[];
  const add=x=>{if(x&&typeof x==='object')rows.push(x)};
  for(const market of ['jp','us']){
    for(const x of state?.momentum?.[market]?.rows||[])add(x);
    for(const x of Object.values(state?.stage?.[market]?.stocks||{}))add(x);
    for(const x of state?.ranking?.[market]?.items||[])add(x);
  }
  for(const x of state?.explorer?.items||[])add(x);
  for(const x of state?.watch?.items||[])add(x);
  for(const x of state?.positions?.positions||[])add(x);
  return rows;
}

function preferredName(symbol,fallback=''){
  const sym=upper(symbol);
  const matches=collectRows().filter(x=>upper(x.symbol)===sym);
  const japanese=matches.map(x=>x.name).find(hasJapanese);
  if(japanese)return japanese;
  if(hasJapanese(fallback))return fallback;
  return fallback||code(symbol)||symbol;
}

async function resolvePreferredName(symbol,fallback=''){
  let name=preferredName(symbol,fallback);
  if(marketOf(symbol)!=='jp'||hasJapanese(name))return name;
  const requests=[
    ['/api/stage?market=jp','stage'],
    ['/api/ranking?market=jp','ranking'],
    ['/api/universe','universe']
  ];
  for(const [url,type] of requests){
    try{
      const d=await api(url);
      if(type==='stage')state.stage.jp=d;
      if(type==='ranking')state.ranking.jp=d;
      const pool=type==='stage'?Object.values(d.stocks||{}):type==='ranking'?(d.items||[]):[...(d.current?.jp||[]),...(d.proposal?.jp?.adds||[])];
      const hit=pool.find(x=>upper(x.symbol)===upper(symbol)&&hasJapanese(x.name));
      if(hit)return hit.name;
    }catch{}
  }
  return name;
}

window.v52OpenRegistered=()=>{closeModal();switchTab('watch');setWatchView('universe')};
window.v52OpenMargin=()=>{closeModal();switchTab('watch');setWatchView('margin')};
window.v52Toggle=id=>{const el=document.getElementById(id);if(el)el.classList.toggle('hidden')};
window.v52ToggleTheme=(id,button)=>{const el=document.getElementById(id);if(!el)return;el.classList.toggle('hidden');button?.classList.toggle('open',!el.classList.contains('hidden'))};

function installStyles(){
  if(document.getElementById('v52-usability-style'))return;
  const style=document.createElement('style');
  style.id='v52-usability-style';
  style.textContent=`
  .margin-overview{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;padding:10px 12px;border:1px solid #d7e2e4;border-radius:13px;background:#f8fbfb;cursor:pointer}.margin-overview b{font-size:12px}.margin-overview span{font-size:10px;color:var(--muted)}.margin-overview .danger{color:var(--red);font-weight:800}.margin-overview .good{color:var(--green);font-weight:800}
  .v52-theme-card{margin:9px 0;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden;box-shadow:var(--shadow)}.v52-theme-toggle{display:block;width:100%;padding:13px 14px;border:0;border-radius:0;background:#fff;text-align:left;color:inherit}.v52-theme-toggle:hover{background:#f8fbfb}.v52-theme-toggle.open{border-bottom:1px solid var(--line)}.v52-theme-body{padding:7px 11px 11px}.v52-theme-leader{border:1px solid var(--line);border-radius:12px;background:#fbfcfd;margin:7px 0;overflow:hidden}.v52-theme-leader-main{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 11px}.v52-theme-leader-main .name{font-size:13px}.v52-theme-leader-actions{display:flex;gap:5px;margin-left:auto}.v52-theme-leader-actions button{padding:5px 8px;font-size:10px}.v52-theme-inline{padding:0 11px 10px;border-top:1px solid var(--line);background:#fff}.v52-theme-inline .meta{padding-top:8px}.v52-theme-more{width:100%;margin-top:7px}.v52-theme-summary{display:flex;gap:7px 12px;flex-wrap:wrap;margin-top:7px;font:10px var(--mono);color:var(--muted)}
  .v52-settings-card{padding:13px;border:1px solid var(--line);border-radius:14px;background:#f8fafb}.v52-settings-card h3{font-size:13px;margin:0 0 5px}.v52-settings-card p{font-size:10px;color:var(--muted);line-height:1.6;margin:0 0 9px}.v52-settings-actions{display:flex;gap:6px;flex-wrap:wrap}.v52-settings-input{width:100%;padding:9px 10px;border:1px solid var(--lineStrong);border-radius:8px;background:#fff;margin:7px 0}
  .v52-register-intro{padding:13px 14px;margin:0 0 10px;border-radius:15px;background:linear-gradient(135deg,#143044,#155d62);color:#fff}.v52-register-intro h2{font-size:18px;margin:0}.v52-register-intro p{font-size:10px;color:#d8e8e8;margin:4px 0 0}.universe-current.v52-promoted{border-color:#b9d8d4;box-shadow:0 6px 20px rgba(20,80,80,.07)}.universe-current-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.universe-current-row small{margin-left:auto}
  @media(max-width:720px){.v52-theme-leader-actions{width:100%;margin-left:0}.v52-theme-leader-actions button{flex:1}.margin-overview{align-items:flex-start}}
  `;
  document.head.appendChild(style);
}

function installSettings(){
  window.openSettings=async function(){
    $('modal-title').textContent='設定';
    $('modal-body').innerHTML=`<div class="settings-grid">
      <div class="v52-settings-card"><h3>登録銘柄</h3><p>日本株・米国株の分析対象一覧を確認し、固定・追加・削除を管理します。</p><div class="v52-settings-actions"><button class="primary" onclick="v52OpenRegistered()">登録銘柄一覧</button><button onclick="closeModal();openStockEditor()">銘柄を編集</button></div></div>
      <div class="v52-settings-card"><h3>信用需給</h3><p>週次信用残、日々公表、特別周知、信用規制の状態をまとめて確認します。</p><div class="v52-settings-actions"><button onclick="v52OpenMargin()">信用需給を開く</button></div></div>
      <div class="v52-settings-card"><h3>通知</h3><p>対応端末ではVANTAGEからのプッシュ通知を有効化できます。</p><div class="v52-settings-actions"><button onclick="enablePush()">通知を有効化</button><button onclick="testPush()">テスト通知</button></div></div>
      <div class="v52-settings-card"><h3>書き込みキー</h3><p>バックエンドの更新操作に使用します。ブラウザ内だけに保存されます。</p><input id="write-key" class="v52-settings-input" type="password" value="${esc(localStorage.getItem('vantage_write_key')||'')}" placeholder="書き込みキー"><div class="v52-settings-actions"><button onclick="saveWriteKey()">保存</button></div></div>
      <div class="v52-settings-card settings-wide"><div class="settings-head"><div><h3>システム状態</h3><p>バックエンド、日米データ、登録銘柄の自動管理状態を確認します。</p></div><button onclick="checkSystemStatus()">再確認</button></div><div id="system-status"><div class="loading compact">確認中…</div></div></div>
    </div>`;
    openModal();
    await checkSystemStatus();
  };
}

function marginOverview(m){
  if(m!=='jp')return;
  const root=$('stage-summary');if(!root||root.querySelector('.margin-overview'))return;
  const rows=Object.values(state?.stage?.jp?.stocks||{}).filter(x=>x?.market==='jp'||marketOf(x?.symbol)==='jp');
  if(!rows.length)return;
  const available=rows.filter(x=>x.margin_supply?.available);
  const warn=available.filter(x=>Number(x.supply_score)<=-7||x.margin_add_blocked).length;
  const good=available.filter(x=>Number(x.supply_score)>=4).length;
  const wait=rows.length-available.length;
  const asOf=available.map(x=>x.margin_supply?.as_of||x.margin_supply?.weekly_as_of).find(Boolean)||'基準日待ち';
  const el=document.createElement('div');
  el.className='margin-overview';
  el.onclick=window.v52OpenMargin;
  el.innerHTML=`<b>信用需給</b><span class="danger">警戒 ${warn}</span><span class="good">追い風 ${good}</span><span>データ待ち ${wait}</span><span>${esc(asOf)}</span><span>詳細 ›</span>`;
  const target=root.querySelector('.focus-strip')||root.firstElementChild;
  if(target?.nextSibling)root.insertBefore(el,target.nextSibling);else root.prepend(el);
}

function installSummaryOverride(){
  const original=window.renderSummary;
  if(typeof original!=='function'||original.__v52)return;
  const wrapped=function(m){const result=original.apply(this,arguments);marginOverview(m);return result};
  wrapped.__v52=true;
  window.renderSummary=wrapped;
}

function leaderRow(r,index,themeNameValue,extraHidden){
  const m=marketOf(r.symbol),name=preferredName(r.symbol,r.name),rowId=`v52-leader-${safeId(r.symbol)}-${index}-${Math.random().toString(36).slice(2,7)}`;
  const margin=m==='jp'?marginBadgeHtml(r):'';
  const marginDetail=m==='jp'&&typeof marginSupplyHtml==='function'?marginSupplyHtml(r):'';
  return `<div class="v52-theme-leader ${extraHidden?'v52-extra hidden':''}">
    <div class="v52-theme-leader-main"><span class="market-chip ${m}">${m==='jp'?'JP':'US'}</span><span class="badge ${r.entry_lane||'D'}">${esc(r.entry_lane||'D')}</span><span class="name grow1">${esc(name)}</span><span class="code">${esc(code(r.symbol))}</span>${margin}<span class="${cls(r.rs5)} num">市場差 ${pct(r.rs5)}</span>
      <div class="v52-theme-leader-actions"><button onclick="openChart('${attr(r.symbol)}')">チャート</button><button onclick="v52Toggle('${rowId}')">詳細</button><button class="primary" onclick="openFrame('${attr(r.symbol)}','${attr(name)}','${m}','theme')">FRAME</button></div>
    </div>
    <div id="${rowId}" class="v52-theme-inline hidden"><div class="meta"><span>出来高 ${num(r.effective_vol_ratio??r.vol_ratio)}x</span><span>25MA ${pct(r.div25)}</span><span>RSI ${r.rsi??'—'}</span><span>${esc(r.long_stage||r.stage||r.stage_code||'—')}</span>${r.setup_label?`<span>${esc(r.setup_label)}</span>`:''}</div>${quoteHtml(r,m,true)}${marginDetail}<div class="note">${esc(themeNameValue)}の先導候補。売買水準はFRAMEで独立判定します。</div></div>
  </div>`;
}

function installThemeOverride(){
  if(typeof window.themeCard!=='function')return;
  window.themeCard=function(group){
    const p=group.phase,leaders=[...group.rows].sort((a,b)=>(Number(b.rs5)||-99)-(Number(a.rs5)||-99));
    const id=`v52-theme-${++window.__v52ThemeSeq}`;
    const autoOpen=['GERMINATION','RECOVERY','EXPANSION'].includes(p.code);
    const visible=leaders.slice(0,3),extra=leaders.slice(3,12);
    const regional=`<div class="region-line"><span>伝播 <b>${esc(p.propagation)}</b></span><span>範囲 <b>${esc(p.coverage)}</b></span>${p.jp?`<span>JP ${p.jp.n}銘柄</span>`:''}${p.us?`<span>US ${p.us.n}銘柄</span>`:''}</div>`;
    return `<section class="v52-theme-card ${p.kind}"><button class="v52-theme-toggle ${autoOpen?'open':''}" onclick="v52ToggleTheme('${id}',this)"><div class="theme-card-head"><div class="grow1"><div class="theme-title">${esc(group.name)}</div><div class="theme-reason">${esc(p.reason)}</div></div>${phaseBadge(p)}</div><div class="v52-theme-summary"><span>市場差RS5 <b class="${cls(p.rs5)}">${pct(p.rs5)}</b></span><span>市場差RS20 <b class="${cls(p.rs20)}">${pct(p.rs20)}</b></span><span>A/B <b>${p.a+p.b}/${p.n}</b></span><span>広がり <b>${num(p.breadth,0)}%</b></span><span>確度 <b>${num(p.confidence,0)}%</b></span></div>${regional}${themeHistoryLine(group)}</button><div id="${id}" class="v52-theme-body ${autoOpen?'':'hidden'}">${visible.map((r,i)=>leaderRow(r,i,group.name,false)).join('')}${extra.map((r,i)=>leaderRow(r,i+3,group.name,true)).join('')}${extra.length?`<button class="v52-theme-more" onclick="this.closest('.v52-theme-body').querySelectorAll('.v52-extra').forEach(x=>x.classList.toggle('hidden'));this.textContent=this.textContent.includes('全')?'上位3銘柄に戻す':'全銘柄を見る'">全銘柄を見る（${leaders.length}）</button>`:''}<div class="note">上位3銘柄は常時確認できます。銘柄詳細は同じ場所に展開されるため、モーダルを閉じる操作は不要です。</div></div></section>`;
  };
  window.__v52ThemeSeq=window.__v52ThemeSeq||0;
}

function installNameOverrides(){
  if(typeof window.openFrame==='function'&&!window.openFrame.__v52){
    const original=window.openFrame;
    const wrapped=function(symbol,name,market,source){return original.call(this,symbol,preferredName(symbol,name),market,source)};
    wrapped.__v52=true;window.openFrame=wrapped;
  }
  window.openAddWatch=function(){
    $('modal-title').textContent='ウォッチ追加';
    $('modal-body').innerHTML=`<div class="formgrid"><select id="aw-market"><option value="jp">日本株</option><option value="us">米国株</option></select><input id="aw-symbol" placeholder="日本4桁 / 米国ティッカー"><input class="span2" id="aw-name" placeholder="日本語名（通常は自動取得・必要時のみ入力）"><div class="span2 note">日本株は登録データ・市場ランキング・現在分析の順で日本語名を優先します。取得できない銘柄だけ日本語名を補足できます。</div><div class="span2 actions"><button class="primary" onclick="addWatchManual()">追加</button></div></div>`;
    openModal();
  };
  window.addWatchManual=async function(){
    const market=$('aw-market').value,symbol=$('aw-symbol').value.trim(),manual=$('aw-name')?.value.trim();
    if(!symbol){toast('銘柄コードを入力してください');return}
    try{
      const q=await api('/api/watchlist',{method:'POST',body:{action:'resolve_name',market,symbol}});
      let name=manual||await resolvePreferredName(q.symbol,q.name);
      if(market==='jp'&&!hasJapanese(name)){
        const entered=prompt('日本語名を確認してください',code(q.symbol));
        if(entered?.trim())name=entered.trim();
      }
      await api('/api/watchlist',{method:'POST',body:{action:'add',market,symbol:q.symbol,name,source:'manual'}});
      toast(`${name}を追加しました`);closeModal();loadWatch();
    }catch(e){toast(e.message)}
  };
}

function installUniverseEnhancement(){
  const tab=document.querySelector('[data-watch-view="universe"]');
  if(tab)tab.textContent='登録銘柄';
  if(typeof window.universeCurrentBlock==='function'){
    window.universeCurrentBlock=function(label,items=[]){
      const groups=new Map();for(const x of items){const tier=x.tier_label||x.tier||'登録';if(!groups.has(tier))groups.set(tier,[]);groups.get(tier).push(x)}
      return `<details class="card universe-current v52-promoted" open><summary class="row"><div class="name grow1">${label}・現在の登録銘柄</div><span class="count">${items.length}件</span></summary><div class="pad">${items.length?[...groups].map(([tier,rows])=>`<div class="section-title">${esc(tier)} ${rows.length}件</div><div class="universe-current-grid">${rows.map(x=>{const r=typeof findCandidate==='function'?findCandidate(x.symbol):null;return `<div class="universe-current-row"><span class="name">${esc(preferredName(x.symbol,x.name||x.symbol))}</span><span class="code">${esc(code(x.symbol))}</span>${marketOf(x.symbol)==='jp'&&r?marginBadgeHtml(r):''}${x.pinned?'<span class="pin-state">固定</span>':''}${x.protected_reason?`<span class="watch-mini">${esc(x.protected_reason)}</span>`:''}<small>${x.source==='auto_rotation'?'自動追加':x.source==='manual'?'手動追加':'登録済み'}</small></div>`}).join('')}</div>`).join(''):'<div class="empty">登録なし</div>'}</div></details>`;
    };
  }
  if(typeof window.loadUniverse==='function'&&!window.loadUniverse.__v52){
    const original=window.loadUniverse;
    const wrapped=async function(){const result=await original.apply(this,arguments);promoteRegisteredList();return result};
    wrapped.__v52=true;window.loadUniverse=wrapped;
  }
}

function promoteRegisteredList(){
  const root=$('universe-list');if(!root||root.querySelector('.v52-register-intro'))return;
  const cards=[...root.querySelectorAll('.universe-current')];if(!cards.length)return;
  const intro=document.createElement('div');intro.className='v52-register-intro';intro.innerHTML=`<h2>現在の登録銘柄</h2><p>VANTAGEが日々分析している全銘柄です。自動入替の提案より先に一覧を表示します。</p>`;
  root.prepend(intro);
  let anchor=intro;
  for(const card of cards){anchor.after(card);anchor=card;card.open=true;card.classList.add('v52-promoted')}
  for(const title of root.querySelectorAll('.section-title'))if(title.textContent.trim()==='現在の登録銘柄')title.remove();
  const autoTitle=document.createElement('div');autoTitle.className='section-title';autoTitle.textContent='自動入替・テーマ構成';anchor.after(autoTitle);
}

function observeEnhancements(){
  const observer=new MutationObserver(()=>{
    const tab=document.querySelector('[data-watch-view="universe"]');if(tab&&tab.textContent!=='登録銘柄')tab.textContent='登録銘柄';
    if(state?.watchView==='universe')promoteRegisteredList();
  });
  observer.observe(document.body,{subtree:true,childList:true});
}

installStyles();
installSettings();
installSummaryOverride();
installThemeOverride();
installNameOverrides();
installUniverseEnhancement();
observeEnhancements();
setTimeout(()=>{try{if(state?.stage?.jp)marginOverview(state.market)}catch{}},0);
console.info('VANTAGE usability fixes loaded',VERSION);
})();

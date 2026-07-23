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
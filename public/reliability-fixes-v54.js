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
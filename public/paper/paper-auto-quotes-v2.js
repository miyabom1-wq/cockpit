(()=>{
'use strict';
const PAPER_API='https://cockpit-backend.miyab.workers.dev';
let paperQuoteBusy=false;
let paperQuoteMessage='';
let paperCandidates=[];

const finitePrice=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>0;
const paperEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paperSymbol=p=>{
  const s=String(p?.symbol||'').trim().toUpperCase();
  if((p?.market||'jp')==='jp'&&!s.endsWith('.T'))return `${s}.T`;
  return s;
};
const paperTime=v=>{
  if(!v)return'';
  const d=new Date(v);
  return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
};
async function paperFetch(path){
  const r=await fetch(PAPER_API+path,{cache:'no-store'});
  let d=null;try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d?.error||`API ${r.status}`);
  return d;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
function stageMap(stage){
  const out=new Map();
  for(const [key,row] of Object.entries(stage?.stocks||{})){
    const symbol=String(row?.symbol||key).toUpperCase();
    out.set(symbol,row||{});
  }
  return out;
}

window.refreshPaperQuotes=async function(silent=false){
  if(paperQuoteBusy)return;
  if(!db.positions.length){paperQuoteMessage='建玉登録後に現在値を自動取得します。';renderPositions();return;}
  paperQuoteBusy=true;
  paperQuoteMessage='価格を取得中…';
  renderPositions();
  try{
    const markets=new Set(db.positions.map(p=>p.market==='us'?'us':'jp'));
    const stages={};
    await Promise.all([...markets].map(async market=>{
      try{stages[market]=await paperFetch(`/api/stage?market=${market}`)}catch{stages[market]=null}
    }));
    const maps={jp:stageMap(stages.jp),us:stageMap(stages.us)};
    const missing=[];
    let updated=0;
    for(const p of db.positions){
      const market=p.market==='us'?'us':'jp',symbol=paperSymbol(p),row=maps[market].get(symbol);
      if(finitePrice(row?.price)){
        p.current=Number(row.price);
        p.current_at=row.price_time||row.updated_at||(row.date?`${row.date}T15:00:00.000Z`:new Date().toISOString());
        p.current_source=row.close_confirmed?'VANTAGE確定終値':'VANTAGE市場データ';
        updated++;
      }else missing.push(p);
    }
    const fallback=await mapLimit(missing,5,async p=>{
      try{
        const q=await paperFetch(`/api/lookup?symbol=${encodeURIComponent(paperSymbol(p))}`);
        return finitePrice(q?.price)?{p,q}:null;
      }catch{return null}
    });
    for(const hit of fallback){
      if(!hit)continue;
      const seconds=Number(hit.q.regular_market_time);
      hit.p.current=Number(hit.q.price);
      hit.p.current_at=hit.q.price_time||(seconds>0?new Date(seconds*1000).toISOString():new Date().toISOString());
      hit.p.current_source='個別価格取得';
      updated++;
    }
    save();
    paperQuoteMessage=updated?`${updated}/${db.positions.length}件更新 · ${paperTime(new Date().toISOString())}`:'価格を取得できませんでした';
    render();
    if(!silent)alert(updated?`現在値を${updated}件更新しました`:'現在値を取得できませんでした');
  }catch(e){
    paperQuoteMessage=`更新失敗: ${e.message}`;
    renderPositions();
    if(!silent)alert(paperQuoteMessage);
  }finally{
    paperQuoteBusy=false;
  }
};

renderPositions=function(){
  const el=document.getElementById('positions');
  const toolbar=`<div class="card"><div class="actions" style="margin-top:0"><button class="btn primary" onclick="refreshPaperQuotes(false)" ${paperQuoteBusy?'disabled':''}>${paperQuoteBusy?'取得中…':'現在値を自動更新'}</button><span class="note">${paperEsc(paperQuoteMessage||'VANTAGEの市場データを使い、少なくとも直近終値を自動取得します。')}</span></div></div>`;
  if(!db.positions.length){el.innerHTML=toolbar+'<div class="card empty">建玉はありません</div>';return}
  el.innerHTML=toolbar+db.positions.map(p=>{
    const cur=finitePrice(p.current)?Number(p.current):n(p.avg),pl=(cur-p.avg)*p.qty,rate=(cur/p.avg-1)*100,risk=(p.avg-p.stop)*p.qty,r=risk>0?pl/risk:0;
    const updated=p.current_at?`${p.current_source||'自動取得'} · ${paperTime(p.current_at)}`:'未取得';
    return `<div class="card"><div style="display:flex;justify-content:space-between"><div><b>${paperEsc(p.name||p.symbol)}</b><div class="sub">${paperEsc(p.symbol)} · ${paperEsc(p.market.toUpperCase())} · ${paperEsc(p.frame)}</div></div><span class="badge">${paperEsc(p.lane||'未分類')}</span></div><div class="grid" style="margin-top:12px"><div><div class="k">平均取得</div><div class="v mono">${fmt(p.avg)}</div></div><div><div class="k">現在値（自動・手動可）</div><input class="cur" data-id="${paperEsc(p.id)}" type="number" step="any" value="${cur}"><div class="note">${paperEsc(updated)}</div></div><div><div class="k">含み損益</div><div class="v ${pl>=0?'up':'down'} mono">${pl>=0?'+':''}${fmt(pl)}</div></div><div><div class="k">損益率 / R</div><div class="v ${rate>=0?'up':'down'} mono">${rate.toFixed(2)}% / ${r.toFixed(2)}R</div></div></div><div class="note">損切 ${fmt(p.stop)} ｜ 目標 ${fmt(p.target)}<br>${paperEsc(p.thesis||'')}</div><div class="actions"><button class="btn" onclick="exitTrade('${paperEsc(p.id)}',true)">一部EXIT</button><button class="btn danger" onclick="exitTrade('${paperEsc(p.id)}',false)">全EXIT</button></div></div>`;
  }).join('');
  document.querySelectorAll('.cur').forEach(i=>i.onchange=()=>{
    const p=db.positions.find(x=>x.id===i.dataset.id);
    if(!p)return;
    p.current=n(i.value);p.current_at=new Date().toISOString();p.current_source='手動入力';save();render();
  });
};

loadVantageCandidates=async function(){
  const out=document.getElementById('vantageList');out.textContent='読込中…';
  try{
    const [jp,us]=await Promise.all([paperFetch('/api/momentum?market=jp'),paperFetch('/api/momentum?market=us')]);
    paperCandidates=[...(jp.rows||[]),...(us.rows||[])].filter(x=>['A','B','C'].includes(x.entry_lane)).slice(0,24);
    if(!paperCandidates.length)throw new Error('候補なし');
    out.innerHTML='<b>VANTAGE候補:</b> '+paperCandidates.map((x,i)=>`<button class="btn" style="padding:5px 8px;margin:4px" onclick="pickPaperCandidate(${i})">${paperEsc(x.name||x.symbol)}</button>`).join('');
  }catch(e){out.textContent='VANTAGE候補を取得できませんでした。銘柄コードを手入力してください。'}
};
window.pickPaperCandidate=index=>{
  const x=paperCandidates[Number(index)];if(!x)return;
  const m=x.market==='us'?'us':'jp';
  market.value=m;symbol.value=m==='jp'?String(x.symbol||'').replace(/\.T$/,''):String(x.symbol||'');name.value=x.name||x.symbol||'';
  if(finitePrice(x.price))price.value=x.price;lane.value=x.entry_lane||'';
};

const originalAddTrade=addTrade;
addTrade=function(){
  const before=db.positions.length;
  originalAddTrade();
  if(db.positions.length>before)setTimeout(()=>refreshPaperQuotes(true),0);
};

const addButton=document.getElementById('add');if(addButton)addButton.onclick=addTrade;
const loadButton=document.getElementById('loadVantage');if(loadButton)loadButton.onclick=loadVantageCandidates;
render();
addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPaperQuotes(true)});
setInterval(()=>{if(!document.hidden)refreshPaperQuotes(true)},300000);
setTimeout(()=>refreshPaperQuotes(true),300);
})();

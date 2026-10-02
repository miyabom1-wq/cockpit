// A strongly consistent SQLite Durable Object owns the counters. Never count
// KV writes in KV: concurrent invocations could lose increments there.
export const WRITE_LIMITS=Object.freeze({background:550,analysis:250,user:100});
const CHUNK=32;
const coordinationKey=key=>key==='system:scheduler-health:v1'||/^sched:/.test(key)||/^ranking:status:(jp|us)$/.test(key);
const day=()=>new Date().toISOString().slice(0,10);
export class WriteBudget {
  constructor(ctx){
    this.storage=ctx.storage;this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS coordination (key TEXT PRIMARY KEY, value TEXT, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS coordination_expiry ON coordination(expires)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS budgets (day TEXT, lane TEXT, used INTEGER NOT NULL, PRIMARY KEY(day,lane))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, day TEXT, lane TEXT, amount INTEGER, settled INTEGER NOT NULL DEFAULT 0)');
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/status'){
      const rows=[...this.sql.exec('SELECT lane,used FROM budgets WHERE day=?',day())];
      return Response.json({day:day(),limits:WRITE_LIMITS,used:Object.fromEntries(rows.map(x=>[x.lane,x.used])),total_limit:900,reset_at:new Date(Date.parse(day())+86400000).toISOString()});
    }
    const body=await request.json();
    if(url.pathname==='/coord'){
      if(!coordinationKey(body.key)||String(body.key).length>512)return new Response('invalid key',{status:400});
      const now=Date.now();
      this.sql.exec('DELETE FROM coordination WHERE expires<=?',now);
      if(body.action==='get'){
        const row=[...this.sql.exec('SELECT value FROM coordination WHERE key=?',body.key)][0];
        return Response.json({value:row?.value??null});
      }
      if(body.action!=='put'&&body.action!=='delete')return new Response('invalid action',{status:400});
      const value=body.action==='delete'?null:String(body.value);
      if(value!==null&&new TextEncoder().encode(value).length>65536)return new Response('value too large',{status:413});
      const ttl=Math.min(604800,Math.max(60,Number(body.ttl)||604800));
      this.sql.exec('INSERT INTO coordination VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires',body.key,value,now+ttl*1000);
      return Response.json({ok:true});
    }
    if(url.pathname==='/reserve'){
      if(!Object.hasOwn(WRITE_LIMITS,body.lane))return new Response('invalid lane',{status:400});
      const result=this.storage.transactionSync(()=>{
        const date=day(),limit=WRITE_LIMITS[body.lane];
        const used=[...this.sql.exec('SELECT used FROM budgets WHERE day=? AND lane=?',date,body.lane)][0]?.used||0;
        const amount=Math.min(CHUNK,limit-used);
        if(amount<=0)return {ok:false,day:date,lane:body.lane,limit};
        const id=crypto.randomUUID();
        this.sql.exec('INSERT INTO budgets VALUES(?,?,?) ON CONFLICT(day,lane) DO UPDATE SET used=excluded.used',date,body.lane,used+amount);
        this.sql.exec('INSERT INTO leases(id,day,lane,amount) VALUES(?,?,?,?)',id,date,body.lane,amount);
        return {ok:true,id,day:date,lane:body.lane,amount};
      });
      return Response.json(result);
    }
    if(url.pathname==='/settle'){
      const result=this.storage.transactionSync(()=>{
        const lease=[...this.sql.exec('SELECT * FROM leases WHERE id=?',String(body.id))][0];
        if(!lease||lease.settled)return {ok:true};
        const used=Number(body.used);
        if(!Number.isInteger(used)||used<0||used>lease.amount)return {ok:false};
        this.sql.exec('UPDATE budgets SET used=used-? WHERE day=? AND lane=?',lease.amount-used,lease.day,lease.lane);
        this.sql.exec('UPDATE leases SET settled=1 WHERE id=?',lease.id);
        const cutoff=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
        this.sql.exec('DELETE FROM leases WHERE day<?',cutoff);
        this.sql.exec('DELETE FROM budgets WHERE day<?',cutoff);
        return {ok:true};
      });
      return Response.json(result);
    }
    return new Response('Not found',{status:404});
  }
}
export function budgetStub(env){
  if(!env.WRITE_BUDGET)throw Object.assign(new Error('保存予算の設定が未反映です。Workerを設定ファイルと一緒に更新してください。'),{status:503});
  return env.WRITE_BUDGET.get(env.WRITE_BUDGET.idFromName('vantage-write-budget-v1'));
}
export async function budgetStatus(env){return (await budgetStub(env).fetch('https://budget/status')).json();}
export function requestLane(request,body={}){
  const u=new URL(request.url),p=u.pathname;
  if(request.method!=='GET'&&(
    ['/api/positions','/api/discipline-state','/api/push/subscribe','/api/push/unsubscribe'].includes(p)||
    p==='/api/watchlist'&&['add','update','delete'].includes(body.action)||
    p==='/api/events'||p==='/api/stocklist'||p==='/api/universe'&&body.action==='config'
  ))return 'user';
  if(request.method!=='GET'||u.searchParams.get('refresh')==='1'||new Set(['/api/stage-run','/api/signal-log-capture','/api/push/test','/api/backtest-run','/api/migrate','/api/theme-history-capture','/api/events-sync']).has(p))return 'analysis';
  return 'read';
}
export function scopedStorage(env,lane){
  const raw=env.COCKPIT_KV,overlay=new Map();let lease=null,consumed=0,queue=Promise.resolve(),closed=false;
  const error=()=>Object.assign(new Error(`${lane==='background'?'自動更新':lane==='user'?'管理操作':'手動分析'}の本日の保存予算に達しました。既存データは保持しています。日本時間9時に再開します。`),{status:429,code:'WRITE_BUDGET_EXHAUSTED'});
  async function settle(){
    if(!lease?.ok)return;
    const res=await budgetStub(env).fetch('https://budget/settle',{method:'POST',body:JSON.stringify({id:lease.id,used:consumed})});
    if(!res.ok||!(await res.json()).ok)throw Error('保存予算の精算に失敗しました');
    lease=null;consumed=0;
  }
  function spend(){
    const next=queue.then(async()=>{
      if(closed)throw error();
      if(!lease?.ok||lease.day!==day()||consumed>=lease.amount){
        await settle();
        const res=await budgetStub(env).fetch('https://budget/reserve',{method:'POST',body:JSON.stringify({lane})});
        if(!res.ok)throw Object.assign(new Error('保存予算を確認できないため更新を停止しました。'),{status:503});
        lease=await res.json();consumed=0;
      }
      if(!lease.ok)throw error();
      consumed++; // Failed provider writes are also charged.
    });
    queue=next.catch(()=>{});return next;
  }
  async function coord(action,key,value,options){
    const response=await budgetStub(env).fetch('https://budget/coord',{method:'POST',body:JSON.stringify({action,key,value,ttl:options?.expirationTtl})});
    if(!response.ok)throw Object.assign(Error('更新管理データを読み書きできません'),{status:503});
    return response.json();
  }
  const coordinated=key=>env.WRITE_BUDGET&&coordinationKey(key);
  const kv={
    async get(key){
      if(overlay.has(key))return overlay.get(key);
      // Do not import legacy KV markers: expired/deleted markers must never reappear.
      if(coordinated(key))return (await coord('get',key)).value;
      return raw.get(key);
    },
    async put(key,value,options){
      if(lane==='read'){overlay.set(key,String(value));return;}
      if(closed)throw error();
      if(coordinated(key)){await coord('put',key,String(value),options);return;}
      await spend();await raw.put(key,value,options);
    },
    async delete(key){
      if(lane==='read'){overlay.set(key,null);return;}
      if(closed)throw error();
      if(coordinated(key)){await coord('delete',key);return;}
      await spend();await raw.delete(key);
    },
    list:(...args)=>raw.list(...args),
  };
  return {env:{...env,COCKPIT_KV:kv},async finish(){
    await queue;closed=true;
    try{await settle();}catch{} // Lost settlement conservatively retains the reservation.
  }};
}

// Keep room for the remaining price batches and daily margin import.
export async function backgroundCapacity(env,reserve=180){
  if(!env.WRITE_BUDGET)return true;
  const status=await budgetStatus(env);
  return status.limits.background-(status.used.background||0)>reserve;
}

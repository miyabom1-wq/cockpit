import {DatabaseSync} from 'node:sqlite';
import {WriteBudget} from '../src/storage/write-budget.js';
import {MockKV} from './helpers.js';
export function budgetTestEnv(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...args){return db.prepare(query).all(...args);}};
 const storage={sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const object=new WriteBudget({storage});
 const stub={fetch:(url,opt)=>object.fetch(new Request(url,opt))};
 const kv=new MockKV();
 return {COCKPIT_KV:kv,WRITE_BUDGET:{idFromName:x=>x,get:()=>stub}};
}

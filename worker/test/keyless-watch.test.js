import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { authorized } from '../src/api/http.js';
import { MockKV } from './helpers.js';

const base='https://vantage-radar.miyab.workers.dev';
test('watch panel can read, add, update and delete with no saved key or server token',async()=>{
  const kv=new MockKV({'meta:schema':'vantage-kv-v3'}),env={COCKPIT_KV:kv};
  const call=async(path,body)=>{
    const response=await worker.fetch(new Request(base+path,body?{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)}:{headers:{'Sec-Fetch-Site':'same-origin'}}),env,{});
    assert.equal(response.status,200);return response.json();
  };
  for(const path of ['/api/watchlist','/api/positions','/api/stocklist?market=jp','/api/universe'])assert.equal((await call(path)).ok,true,path);
  const added=await call('/api/watchlist',{action:'add',symbol:'TEST',market:'us',name:'テスト銘柄'});
  assert.equal(added.added,true);
  assert.equal((await call('/api/watchlist')).items[0].symbol,'TEST');
  assert.equal((await call('/api/watchlist',{action:'update',id:added.item.id,status:'waiting'})).item.status,'waiting');
  assert.equal((await call('/api/watchlist',{action:'delete',id:added.item.id})).ok,true);
  assert.deepEqual((await call('/api/watchlist')).items,[]);
});

test('Pages frontend and installed app keep working even with a stale saved key',()=>{
  for(const headers of [{Origin:'https://miyabom1-wq.github.io'},{Referer:base+'/'},{'Sec-Fetch-Site':'same-origin'}]){
    assert.equal(authorized(new Request(base+'/api/watchlist',{headers:{...headers,'X-Vantage-Key':'old-key'}}),{WRITE_TOKEN:'new-key'}),true);
  }
});

test('conflicting or malformed browser origins are rejected without a valid API key',()=>{
  for(const headers of [{Origin:'null','Sec-Fetch-Site':'same-origin'},{Origin:'https://unrelated.example',Referer:base+'/'},{Referer:'invalid','Sec-Fetch-Site':'same-origin'},{Referer:base+'.unrelated.example/'}]){
    assert.equal(authorized(new Request(base+'/api/watchlist',{method:'POST',headers}),{}),false);
  }
});

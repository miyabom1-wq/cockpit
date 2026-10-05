import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getWatchlist} from '../src/services/watchlist.js';
import {KEYS} from '../src/storage/kv-schema.js';
import {MockKV} from './helpers.js';
test('watch membership survives failed stage storage; failure is explicit and no writes',async()=>{
 const kv=new MockKV({[KEYS.watch]:JSON.stringify([{id:'w1',symbol:'7203.T',market:'jp',stage_data:{price:100}}])});
 const get=kv.get.bind(kv);kv.get=async key=>{if(key.startsWith('stage:'))throw Error('503');return get(key)};
 const result=await getWatchlist({COCKPIT_KV:kv});
 assert.equal(result.items.length,1);assert.equal(result.items[0].current_data.price,100);
 assert.equal(result.items[0].data_stale,true);assert.equal(result.items[0].held,null);
 assert.equal(result.degraded,true);assert.ok(result.warnings.length);assert.equal(kv.writes,0);
 kv.get=async()=>{throw Error('watch storage unavailable')};
 await assert.rejects(getWatchlist({COCKPIT_KV:kv}),/watch storage unavailable/);
});
test('momentum 503 does not erase watch cards and stale list fallback is labelled',async()=>{
 const src=readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('  window.loadWatch = async function(){'),src.indexOf('  window.setWatchMarket = function'));
 const state={stage:{},momentum:{},watch:null},root={innerHTML:''};let renders=0,failWatch=false;
 const ctx={window:{},state,$:()=>root,esc:String,finite:Number.isFinite,boardMap:()=>new Map([['7203.T',{price:100}]]),mapLimit:async()=>[],renderWatch:()=>{renders++;root.innerHTML='card'},api:async path=>{
  if(path.includes('momentum')||(failWatch&&path==='/api/watchlist'))throw Object.assign(Error('API 503'),{status:503});
  if(path==='/api/watchlist')return {items:[{symbol:'7203.T'}]};return {};
 }};
 vm.createContext(ctx);vm.runInContext(fn,ctx);await ctx.window.loadWatch();
 assert.equal(renders,1);assert.equal(state.watch.items.length,1);assert.match(state.watchLoadWarnings.join(),/API 503/);
 failWatch=true;await ctx.window.loadWatch();assert.equal(renders,2);assert.match(state.watchLoadWarnings.join(),/前回表示を使用・更新未確認/);
 state.watch=null;await ctx.window.loadWatch();assert.equal(renders,2);assert.match(root.innerHTML,/API 503/);
});

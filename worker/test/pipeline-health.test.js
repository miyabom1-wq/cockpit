import test from 'node:test';
import assert from 'node:assert/strict';
import { stageFreshness } from '../src/services/stage-freshness.js';
import { ENGINE_VERSION } from '../src/config.js';
import { getWatchlist } from '../src/services/watchlist.js';
import { MockKV } from './helpers.js';
const now=new Date('2026-10-06T08:00:00Z');
test('current prices produced by an old engine are not usable assessments',()=>{
 const stage={market:'jp',complete:true,trade_date:'2026-10-06',kind:'confirmed',close_verification:{ratio:100},engine_version:'engine-v52-null-safe',stocks:{'5803.T':{engine_version:'engine-v52-null-safe'}}};
 const f=stageFreshness(stage,now);assert.equal(f.is_stale,false);assert.equal(f.schema_mismatch,true);assert.equal(f.assessment_usable,false);
 stage.engine_version=ENGINE_VERSION;stage.stocks['5803.T']={engine_version:ENGINE_VERSION,momentumState:'acceleration'};
 assert.equal(stageFreshness(stage,now).assessment_usable,true);
});
test('a stopped watch symbol is stale even while its market stage exists',async t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const kv=new MockKV({'watchlist:v1':JSON.stringify([{symbol:'MSTR',market:'us',stage_data:{symbol:'MSTR',market:'us',date:'2026-09-18',price:300,engine_version:ENGINE_VERSION,momentumState:'continuation'}}]),'stage:us':JSON.stringify({market:'us',complete:true,stocks:{},trade_date:'2026-10-05'})});
 const r=await getWatchlist({COCKPIT_KV:kv});assert.equal(r.items[0].data_stale,true);assert.equal(r.items[0].current_data.assessment_usable,false);assert.equal(r.items[0].current_data.data_status,'STALE');
});

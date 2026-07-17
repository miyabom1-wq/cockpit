import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRotationProposal, buildThemeCoverage, scoreUniverseItem } from '../src/services/universe-manager.js';

function history(symbols,days=8){return{snapshots:Array.from({length:days},(_,i)=>({date:`2026-07-${String(i+1).padStart(2,'0')}`,items:symbols.map((symbol,j)=>({symbol,rank:10+j}))}))};}
const weak={entry_lane:'E',rs5:-6,rs20:-8,vol_ratio:.7,stage_code:'S4',div25:-12,rsi14:35};
const strong={entry_lane:'B',rs5:5,rs20:2,vol_ratio:1.6,stage_code:'S2',div25:1,rsi14:61,new_entry:true,rank_change:25};

test('universe score rewards persistent liquid momentum',()=>{
 const low=scoreUniverseItem({item:{},analysis:weak,rank:null,presence:0,market:'us'});
 const high=scoreUniverseItem({item:{},analysis:strong,rank:8,presence:7,market:'us',candidate:true});
 assert.ok(high-low>50);
});

test('rotation replaces a persistently weak unprotected member',()=>{
 const stocklist=[{symbol:'MU',name:'MU'},{symbol:'SNDK',name:'SNDK'},{symbol:'WDC',name:'WDC'}];
 const stageRows=[{symbol:'MU',...weak},{symbol:'SNDK',entry_lane:'A',rs5:3,rs20:4,vol_ratio:1.2},{symbol:'WDC',entry_lane:'C',rs5:1,rs20:1,vol_ratio:1.1}];
 const ranking={items:[{symbol:'STX',rank:8}]};
 const p=buildRotationProposal({market:'us',stocklist,stageRows,ranking,rankingHistory:history(['STX']),candidates:[{symbol:'STX',name:'STX',rank:8,...strong}],protectedSymbols:[],config:{min_history_days:7,weekly_swap_limit:2,theme_minimum:2,candidate_min_score:58,score_advantage:18,mode:'guarded_auto'},targetCount:3});
 assert.equal(p.adds[0].symbol,'STX');
 assert.equal(p.drops[0].symbol,'MU');
 assert.equal(p.can_apply,true);
});

test('held or watched member is never selected for removal',()=>{
 const stocklist=[{symbol:'MU',name:'MU'},{symbol:'SNDK',name:'SNDK'},{symbol:'WDC',name:'WDC'}];
 const stageRows=[{symbol:'MU',...weak},{symbol:'SNDK',entry_lane:'A',rs5:3,rs20:4},{symbol:'WDC',entry_lane:'A',rs5:3,rs20:4}];
 const p=buildRotationProposal({market:'us',stocklist,stageRows,ranking:{items:[{symbol:'STX',rank:8}]},rankingHistory:history(['STX']),candidates:[{symbol:'STX',name:'STX',rank:8,...strong}],protectedSymbols:['MU'],config:{min_history_days:7,weekly_swap_limit:2,theme_minimum:2,candidate_min_score:58,score_advantage:18,mode:'guarded_auto'},targetCount:3});
 assert.equal(p.drops.some(x=>x.symbol==='MU'),false);
});

test('theme minimum prevents a theme from being emptied',()=>{
 const stocklist=[{symbol:'MU',name:'MU'},{symbol:'SNDK',name:'SNDK'}];
 const stageRows=[{symbol:'MU',...weak},{symbol:'SNDK',...weak}];
 const p=buildRotationProposal({market:'us',stocklist,stageRows,ranking:{items:[{symbol:'ANET',rank:5}]},rankingHistory:history(['ANET']),candidates:[{symbol:'ANET',name:'ANET',rank:5,...strong}],protectedSymbols:[],config:{min_history_days:7,weekly_swap_limit:2,theme_minimum:2,candidate_min_score:58,score_advantage:18,mode:'guarded_auto'},targetCount:2});
 assert.equal(p.drops.length,0);
});

test('coverage reports missing and thin themes',()=>{
 const c=buildThemeCoverage([{symbol:'285A.T'}],[{symbol:'MU'}]);
 assert.equal(c.find(x=>x.name==='メモリ・ストレージ').status,'covered');
 assert.equal(c.find(x=>x.name==='ネットワーク・光').status,'missing');
});

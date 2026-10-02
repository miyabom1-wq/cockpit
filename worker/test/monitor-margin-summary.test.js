import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('monitor summary refetches enriched credit scores instead of retaining cached zero',async()=>{
 const src=readFileSync(new URL('../../public/navigation.js',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('async function renderMonitorSummary(){'),src.indexOf('\nfunction installWrappers(){'));
 const root={innerHTML:''},state={watchView:'list',watch:{items:[]},signals:{items:[]},events:{events:[]},stage:{jp:{stocks:{a:{supply_score:0}}}}};
 let calls=0;
 const context={state,document:{getElementById:()=>root},monitorBusy:false,eventRows:()=>[],esc:String,api:async path=>{assert.equal(path,'/api/stage?market=jp');calls++;return {stocks:{a:{supply_score:-20},b:{supply_score:-8},c:{supply_score:0}}};}};
 vm.createContext(context);vm.runInContext(fn,context);await context.renderMonitorSummary();
 assert.equal(calls,1);assert.match(root.innerHTML,/<b>2<\/b><span>需給警戒/);
 context.api=async()=>{throw Error('offline');};await context.renderMonitorSummary();
 assert.match(root.innerHTML,/集約に失敗/);assert.doesNotMatch(root.innerHTML,/<b>0<\/b><span>需給警戒/);
});

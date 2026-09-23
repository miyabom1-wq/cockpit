import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { eventWeekStart, pruneManualEvents, mutateEvent, officialEvents, jpxEventsFromDataset } from '../src/services/events.js';
import { usEventsFromDataset } from '../src/services/us-earnings.js';
import { MockKV } from './helpers.js';
import { KEYS } from '../src/storage/kv-schema.js';
const now=Date.parse('2026-09-23T12:00:00+09:00');
const event=(id,time,extra={})=>({id,time,name:'米国 CPI',category:'macro',symbols:[],source:'manual',...extra});
const rows=[event('old','2026-09-13T23:59:59+09:00'),event('last','2026-09-14T00:00:00+09:00'),event('sun','2026-09-20T23:59:59+09:00'),event('mon','2026-09-21T00:00:00+09:00'),event('future','2026-09-25T12:00:00+09:00'),event('pin','2020-01-01T00:00:00Z',{pinned:true}),event('bad','invalid')];
function env(seed=rows){return {COCKPIT_KV:new MockKV({[KEYS.events]:JSON.stringify(seed)})};}
test('week starts at Monday midnight JST including Sunday UTC and year boundary',()=>{
  assert.equal(new Date(eventWeekStart(now)).toISOString(),'2026-09-20T15:00:00.000Z');
  assert.equal(eventWeekStart(Date.parse('2026-09-20T14:59:59Z')),Date.parse('2026-09-13T15:00:00Z'));
  assert.equal(eventWeekStart(Date.parse('2026-01-01T12:00:00Z')),Date.parse('2025-12-28T15:00:00Z'));
});
test('automatic cleanup preserves previous/current week, pinned and invalid records; no redundant writes',async()=>{
  const e=env();const kept=await pruneManualEvents(e,rows,now);
  assert.deepEqual(kept.map(e=>e.id),['last','sun','mon','future','pin','bad']);
  assert.equal(e.COCKPIT_KV.writes,1);
  await pruneManualEvents(e,kept,now);assert.equal(e.COCKPIT_KV.writes,1);
});
test('cleanup cannot remove this week even when explicitly requested via legacy ids',async()=>{
  const original=Date.now;Date.now=()=>now;
  try{
    const e=env();const result=await mutateEvent(e,{action:'clear_completed',ids:rows.map(e=>e.id)});
    assert.equal(result.removed,3);
    assert.deepEqual(JSON.parse(await e.COCKPIT_KV.get(KEYS.events)).map(e=>e.id),['mon','future','pin','bad']);
    await mutateEvent(e,{action:'clear_completed'});assert.equal(e.COCKPIT_KV.writes,1);
  }finally{Date.now=original;}
});
test('manual numeric updates preserve old fields and zero values; unsafe URLs rejected before writes',async()=>{
  const e=env([event('x','2026-09-23T00:00:00Z',{legacy_field:'keep'})]);
  const r=await mutateEvent(e,{action:'update_results',id:'x',actual:0,forecast:'0.2%',previous:'0.1%'});
  assert.equal(r.event.actual,'0');assert.equal(r.event.legacy_field,'keep');
  await mutateEvent(e,{action:'update_results',id:'x',actual:0,forecast:'0.2%',previous:'0.1%'});
  assert.equal(e.COCKPIT_KV.writes,1);
  await assert.rejects(mutateEvent(e,{action:'update_results',id:'x',source_url:'javascript:alert(1)'}));
  await assert.rejects(mutateEvent(e,{action:'update_results',id:'missing',actual:'1'}));
  assert.equal(e.COCKPIT_KV.writes,1);
});
test('official, JPX and US datasets retain earlier releases in current week',()=>{
  assert.ok(officialEvents(Date.parse('2026-07-26T12:00:00+09:00')).some(e=>e.id==='official-4063-20260724'));
  const jp=jpxEventsFromDataset({schema:'vantage-jpx-earnings-v1',generated_at:'2026-09-23T00:00:00Z',events:[{symbol:'4063.T',date:'2026-09-21'}]},[{symbol:'4063.T',market:'jp'}],now);
  const us=usEventsFromDataset({schema:'vantage-us-earnings-v1',generated_at:'2026-09-23T00:00:00Z',events:[{symbol:'MU',date:'2026-09-21'}]},[{symbol:'MU',market:'us'}],now);
  assert.equal(jp.length,1);assert.equal(us.length,1);
});
function ui(events){
  const nodes={'event-list':{innerHTML:''},'event-clear-old':{},'v59-style':{}};
  const document={getElementById:id=>nodes[id],querySelectorAll:()=>[],body:{}};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx={document,window:{innerWidth:1000},state:{events:{events}},Date:Clock,Intl,URL,MutationObserver:class{observe(){}},queueMicrotask:()=>{},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dateText:()=>'',openModal(){},closeModal(){}};
  ctx.window.openEventForm=()=>{};
  vm.runInNewContext(fs.readFileSync(new URL('../../public/events-ui.js',import.meta.url),'utf8'),ctx);
  ctx.window.renderEvents();return{ctx,nodes};
}
test('UI retains released items, shows zero/equality, sanitizes links, switches weeks and cleanup counts',()=>{
  const {ctx,nodes}=ui([event('x','2026-09-21T01:00:00+09:00',{actual:0,forecast:0,previous:'1',source_url:'javascript:alert(1)'}),event('last','2026-09-18T00:00:00+09:00'),event('next','2026-09-29T00:00:00+09:00',{name:'NEXT EVENT'})]);
  assert.match(nodes['event-list'].innerHTML,/発表済み/);
  assert.match(nodes['event-list'].innerHTML,/予想比 ＝/);
  assert.match(nodes['event-list'].innerHTML,/実績 <b>0/);
  assert.doesNotMatch(nodes['event-list'].innerHTML,/javascript:/);
  assert.equal(nodes['event-clear-old'].textContent,'先週以前を整理（1件）');
  nodes['event-list'].onclick({target:{closest:()=>({dataset:{eventPeriod:'next'}})}});
  assert.match(nodes['event-list'].innerHTML,/NEXT EVENT/);
  ctx.state.events.events=[];ctx.window.renderEvents();assert.equal(nodes['event-clear-old'].hidden,true);
});
test('UI does not compare incompatible units or absent values',()=>{
  const {nodes}=ui([event('x','2026-09-21T01:00:00+09:00',{actual:'1M',forecast:'900K'}),event('y','2026-09-22T01:00:00+09:00',{actual:'',forecast:'0'})]);
  assert.doesNotMatch(nodes['event-list'].innerHTML,/予想比 [↑↓＝]/);
});

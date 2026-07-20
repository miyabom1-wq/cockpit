import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvents, officialEvents, trackedEventUniverse, parseCalendarEventPayload } from '../src/services/events.js';

function env(){return{COCKPIT_KV:{async get(){return null},async put(){}}};}
test('includes verified near-term earnings and marks them read-only',async()=>{
  const now=Date.parse('2026-07-20T00:00:00Z'),items=officialEvents(now),events=await getEvents(env(),now);
  for(const symbol of ['4063.T','2914.T','STX','7011.T','LITE'])assert.ok(items.some(x=>x.symbols.includes(symbol)));
  assert.ok(events.every(x=>x.source!=='official'||x.read_only===true));
});

test('tracked earnings universe follows watch and signal records',()=>{
  const rows=trackedEventUniverse({watch:[{symbol:'4063.T',name:'信越化学',market:'jp'}],signals:[{symbol:'LITE',name:'Lumentum',market:'us',active:true},{symbol:'4063.T',market:'jp'}]});
  assert.deepEqual(rows.map(x=>x.symbol),['4063.T','LITE']);
});
test('provider calendar payload becomes a read-only tracked event',()=>{
  const payload={quoteSummary:{result:[{calendarEvents:{earnings:{earningsDate:[{raw:1786406400}]}}}]}};
  const event=parseCalendarEventPayload(payload,{symbol:'LITE',name:'Lumentum',market:'us',scope:'watch'});
  assert.equal(event.symbols[0],'LITE');assert.equal(event.source,'provider');assert.equal(event.read_only,true);
});

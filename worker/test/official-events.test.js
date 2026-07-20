import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvents, officialEvents } from '../src/services/events.js';

function env(){return{COCKPIT_KV:{async get(){return null},async put(){}}};}
test('includes verified near-term earnings and marks them read-only',async()=>{
  const now=Date.parse('2026-07-20T00:00:00Z'),items=officialEvents(now),events=await getEvents(env(),now);
  for(const symbol of ['4063.T','2914.T','STX','7011.T','LITE'])assert.ok(items.some(x=>x.symbols.includes(symbol)));
  assert.ok(events.every(x=>x.source!=='official'||x.read_only===true));
});

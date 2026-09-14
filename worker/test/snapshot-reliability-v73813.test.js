import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleNodes, schedulerSnapshotLabel, scheduledStage } from '../src/index.js';
import { marketParts } from '../src/services/stage.js';
import { MockKV, syntheticRows, yahooResult } from './helpers.js';

const nodeMap = now => new Map(scheduleNodes(now).nodes.map(node => [node.key, node]));

test('every JP intraday snapshot covers the complete registered capacity', () => {
  const nodes = nodeMap(new Date('2026-07-21T05:20:00.000Z'));
  const expected = marketParts('jp');
  for (const label of ['jp_0930','jp_1020','jp_1130','jp_1420','jp_1505']) {
    for (let part = 1; part <= expected; part++) {
      assert.ok(nodes.has(`${label}:b${part}`), `${label}:b${part} must exist`);
    }
    assert.equal(nodes.get(`${label}:b1`)?.minSessionRatio, 80);
  }
  assert.equal(nodes.get('jp_1130:b1')?.window, 170);
});

test('confirmed JP retries and recovery reuse one close snapshot generation', () => {
  const labels = [
    {market:'jp', kind:'confirmed', key:'jp_1535:b1'},
    {market:'jp', kind:'confirmed', key:'jp_1640_retry:b1'},
    {market:'jp', kind:'confirmed', key:'jp_1735_retry2:b1'},
    {market:'jp', kind:'confirmed', key:'jp_1800_recovery:b1'},
    {market:'jp', kind:'confirmed', key:'jp_overnight_recovery:b1'},
  ].map(schedulerSnapshotLabel);
  assert.deepEqual([...new Set(labels)], ['jp_close']);
  assert.equal(schedulerSnapshotLabel({market:'jp',kind:'intraday',key:'jp_1420:b1'}), 'jp_1420');
});

function stockList(count){
  return Array.from({length:count},(_,i)=>({
    symbol:`${String(2000+i).padStart(4,'0')}.T`,
    name:`対象${i+1}`,
  }));
}

test('JP intraday processing advances one bounded batch per cron', async () => {
  const rows = syntheticRows(300,'2026-07-30');
  const old = globalThis.fetch;

  globalThis.fetch = async request => {
    const url = new URL(String(request));
    const symbol = decodeURIComponent(url.pathname.split('/').at(-1));
    return new Response(JSON.stringify({
      chart:{result:[yahooResult(rows,symbol)],error:null}
    }),{status:200,headers:{'content-type':'application/json'}});
  };

  try {
    const kv = new MockKV({'stocklist:jp':JSON.stringify(stockList(61))});
    const result = await scheduledStage({COCKPIT_KV:kv}, new Date('2026-07-30T05:20:00.000Z'));
    assert.equal(result.processed, 1);
    assert.equal(result.node, 'jp_1420:b1');

    const completed = [...kv.map.keys()]
      .filter(k=>k.includes('stage:working:') && /part:[123]$/.test(k));
    assert.equal(completed.length, 1);
  } finally {
    globalThis.fetch = old;
  }
});
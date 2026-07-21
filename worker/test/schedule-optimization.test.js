import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleNodes } from '../src/index.js';
import { batchFreshnessRatios } from '../src/services/stage.js';

const nodeMap = now => new Map(scheduleNodes(now).nodes.map(node => [node.key, node]));

test('JP close schedule is published shortly after the close', () => {
  const nodes = nodeMap(new Date('2026-07-21T06:35:00.000Z'));
  assert.equal(nodes.get('jp_1505:b1')?.at, 905);
  assert.equal(nodes.get('jp_1535:b1')?.at, 935);
  assert.equal(nodes.get('jp_1535:b8')?.at, 935);
  assert.equal(nodes.get('jp_1535:b1')?.minConfirmedRatio, 90);
  assert.equal(nodes.get('jp_1640_retry:b1')?.at, 1000);
  assert.equal(nodes.get('macro_1630')?.at, 990);
  assert.equal(nodes.has('jp_1520:b1'), false);
  assert.equal(nodes.has('jp_1610:b1'), false);
});

test('US schedules follow daylight saving time', () => {
  const dst = nodeMap(new Date('2026-07-21T13:30:00.000Z'));
  assert.equal(dst.get('us_2230:b1')?.at, 1350);
  assert.equal(dst.get('us_2230:b1')?.minSessionRatio, 80);
  assert.equal(dst.get('us_0505:b1')?.at, 305);
  assert.equal(dst.get('us_0505:b1')?.minConfirmedRatio, 90);
  assert.equal(dst.get('us_0540_retry:b1')?.at, 340);

  const standard = nodeMap(new Date('2026-12-01T14:30:00.000Z'));
  assert.equal(standard.get('us_2330:b1')?.at, 1410);
  assert.equal(standard.get('us_0605:b1')?.at, 365);
  assert.equal(standard.get('us_0640_retry:b1')?.at, 400);
});

test('batch freshness ratios separate session and confirmed rows', () => {
  const rows = [
    { date:'2026-07-21', data_quality:{ close_confirmed:true } },
    { date:'2026-07-21', data_quality:{ close_confirmed:false } },
    { date:'2026-07-18', data_quality:{ close_confirmed:true } },
    { data_quality:{ close_confirmed:false } },
  ];
  assert.deepEqual(batchFreshnessRatios(rows, '2026-07-21'), {
    total:4,
    session:2,
    confirmed:1,
    session_ratio:50,
    confirmed_ratio:25,
  });
});

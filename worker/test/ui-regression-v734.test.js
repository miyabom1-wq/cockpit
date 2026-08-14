import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const workerRoot=path.resolve(here,'..');
const publicRoot=path.resolve(workerRoot,'../public');

test('candidate theme renderer has no out-of-scope helper dependency',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  assert.doesNotMatch(html,/\bthemeSeq\b/);
  assert.match(html,/function themeLeaderRow\(r,theme\)/);
  assert.match(html,/leaders\.map\(r=>themeLeaderRow\(r,group\.name\)\)/);
  const helperAt=html.indexOf('function themeLeaderRow(r,theme)');
  const cardAt=html.indexOf('function themeCard(group)');
  assert.ok(helperAt>=0&&cardAt>helperAt,'theme leader helper must be in the same global scope before themeCard');
});

test('Today prioritizes useful daily context and upcoming events',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  const start=html.indexOf('function renderSummary(m)');
  const end=html.indexOf('function openMacroChart',start);
  assert.ok(start>=0&&end>start);
  const body=html.slice(start,end);
  assert.match(body,/today-context/);
  assert.match(body,/todayScheduleHtml\(m\)/);
  assert.match(html,/10日以内に登録対象の予定はありません/);
  assert.doesNotMatch(body,/stock-daily-grid|A\/B候補|押し目監視|RSI過熱/);
});

test('monitor keeps holdings visible inside watch cards without a duplicate held dashboard card',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  const nav=fs.readFileSync(path.join(publicRoot,'navigation.js'),'utf8');
  assert.match(html,/is-held/);
  assert.match(html,/is-watch/);
  assert.match(nav,/key-watch/);
  assert.doesNotMatch(nav,/key-held/);
  assert.match(nav,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

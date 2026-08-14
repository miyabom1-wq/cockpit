import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const publicRoot=path.resolve(here,'../../public');

test('three tabs keep distinct roles and Today shows schedule plus compact market snapshot',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  const nav=fs.readFileSync(path.join(publicRoot,'navigation.js'),'utf8');
  assert.match(html,/data-tab="stage"[\s\S]*?<span>今日<\/span>/);
  assert.match(html,/data-tab="themes"[\s\S]*?<span>候補<\/span>/);
  assert.match(html,/data-tab="watch"[\s\S]*?<span>監視<\/span>/);
  assert.doesNotMatch(html,/class="workflow-bar"/);
  const start=html.indexOf('function renderSummary(m)');
  const end=html.indexOf('function openMacroChart',start);
  assert.ok(start>=0&&end>start);
  const body=html.slice(start,end);
  assert.match(body,/todayScheduleHtml\(m\)/);
  assert.match(html,/function todayScheduleHtml\(m\)/);
  assert.match(html,/今日の予定/);
  assert.match(html,/24h/);
  assert.doesNotMatch(body,/A\/B候補|押し目監視|RSI過熱|需給警戒/);
  assert.match(body,/todayMacroHtml\(st\)/);
  assert.match(html,/function todayMacroHtml\(st\)/);
  assert.match(html,/class=\"today-macro\"/);
  assert.match(html,/\['日経','日経平均'\]/);
  assert.match(html,/\['SOX','SOX'\]/);
  assert.match(html,/\['KOSPI','韓国KOSPI'\]/);
  assert.match(html,/\['S&P','S&P500'\]/);
  assert.match(html,/\['VIX','VIX'\]/);
  assert.match(html,/\['USD\/JPY','ドル円'\]/);
  assert.doesNotMatch(body,/macro-list|マクロ \/ 指数/);
  assert.match(nav,/予定・地合いの例外・データ更新/);
});

test('Candidate mobile layout keeps theme names and 1D deltas aligned',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  assert.match(html,/theme-focus-line/);
  assert.match(html,/theme-focus-name/);
  assert.match(html,/white-space:nowrap/);
  assert.match(html,/\.theme-alert\{display:grid!important;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(html,/\.theme-alert \.delta\{margin-left:0!important;min-width:76px;text-align:right/);
  assert.doesNotMatch(html,/\bthemeSeq\b/);
});

test('Monitor has no redundant held KPI and watch list sorts held positions first',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  const nav=fs.readFileSync(path.join(publicRoot,'navigation.js'),'utf8');
  assert.match(nav,/key-watch/);
  assert.doesNotMatch(nav,/key-held/);
  assert.match(nav,/key-signal/);
  assert.match(nav,/key-event/);
  assert.match(nav,/key-supply/);
  assert.match(html,/const heldOrder=Number\(isHeld\(b\)\)-Number\(isHeld\(a\)\)/);
  assert.match(html,/heldSymbols=heldSet\(\)/);
  assert.match(html,/isHeld\?'is-held':'is-watch'/);
  assert.match(html,/badge held/);
});

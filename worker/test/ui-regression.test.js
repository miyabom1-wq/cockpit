import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const workerRoot=path.resolve(here,'..');
const html=fs.readFileSync(path.resolve(workerRoot,'../public/index.html'),'utf8');
const nav=fs.readFileSync(path.resolve(workerRoot,'../public/navigation.js'),'utf8');

test('three-tab workflow remains explicit and candidate runtime stays self-contained',()=>{
  for(const tab of ['stage','themes','watch']) assert.match(html,new RegExp(`data-tab="${tab}"`));
  assert.match(nav,/stage:'今日',themes:'候補',watch:'監視'/);
  assert.match(nav,/実行環境を確認/);
  assert.doesNotMatch(html,/themeSeq/);
  assert.match(html,/function themeLeaderRow\(/);
});

test('mobile theme focus and history alerts have dedicated responsive layout',()=>{
  assert.match(html,/class="theme-focus-title"/);
  assert.match(html,/theme-focus-title span:not\(:last-child\)::after/);
  assert.match(html,/grid-template-columns:minmax\(0,1fr\) auto;align-items:center;column-gap:10px/);
  assert.match(html,/theme-alert \.delta\{margin:0;align-self:start;white-space:nowrap/);
});

test('monitor watch and held controls have different behavior and held rows are prioritized',()=>{
  assert.match(nav,/onclick="setMonitorFilter\('all'\)"/);
  assert.match(nav,/onclick="setMonitorFilter\('held'\)"/);
  assert.match(html,/watchFilter:localStorage\.getItem\('vantage_watch_filter'\)\|\|'all'/);
  assert.match(html,/const heldDiff=Number\(isHeldWatch\(b\)\)-Number\(isHeldWatch\(a\)\)/);
  assert.match(html,/if\(state\.watchFilter==='held'\)/);
  assert.match(html,/state\.positions\?\.positions/);
  assert.match(html,/_positionOnly:true/);
});

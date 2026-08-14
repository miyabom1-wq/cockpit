import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const publicRoot=path.resolve(here,'../../public');

test('Today stays focused on market risk instead of duplicating candidate and monitor tabs',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  const nav=fs.readFileSync(path.join(publicRoot,'navigation.js'),'utf8');
  assert.doesNotMatch(nav,/renderTodayOverview|v55-today-overview|上位テーマ|A・B候補/);
  assert.doesNotMatch(html,/次の重要日程|class="focus-strip"|v52-margin-overview/);
  assert.match(html,/todayEventDigest\(\)/);
  assert.match(html,/直近24時間/);
  assert.doesNotMatch(html,/section-title\">地合い/);
  assert.match(html,/\.role-note\{display:none\}/);
  assert.match(html,/時刻未確認\|時刻未公表\|時間未公表/);
});

test('Theme expansion reveals leaders directly and monitor avoids duplicate mystery KPIs',()=>{
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  assert.match(html,/theme-leaders-head/);
  assert.doesNotMatch(html,/v73-leaders|タップで表示/);
  assert.doesNotMatch(html,/watch-overview|価格取得済み|価格待ち<\/div><\/div><\/div>/);
  assert.match(html,/watch-market-switch/);
  assert.match(html,/信用需給を開く/);
  const nav=fs.readFileSync(path.join(publicRoot,'navigation.js'),'utf8');
  assert.match(nav,/v55-kpi:nth-child\(1\).*span 3/);
});

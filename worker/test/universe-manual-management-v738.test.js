import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.resolve(here,'../../public/index.html'),'utf8');

test('registered stocks can be searched by code/ticker and manually added',()=>{
  assert.match(html,/function normalizeUniverseLookupInput\(raw,mode='auto'\)/);
  assert.match(html,/placeholder="5803 \/ 285A \/ MU \/ NVDA"/);
  assert.match(html,/\/api\/lookup\?symbol=/);
  assert.match(html,/action:'add',symbol:x\.symbol,name:x\.name,pinned:true/);
  assert.match(html,/action:'promote',symbol:x\.symbol/);
});

test('registered stocks can be deleted and preserve existing rotation proposal',()=>{
  assert.match(html,/function deleteUniverseFromButton\(button\)/);
  assert.match(html,/action:'delete',symbol/);
  assert.match(html,/data-market="\$\{market\}"/);
  assert.match(html,/async function refreshUniverse\(\)/);
  assert.match(html,/async function applyUniverse\(force=false\)/);
  assert.match(html,/入れ替え提案/);
});

test('manual management owns the mobile-friendly order without v52 reordering it',()=>{
  const manual=html.indexOf('html+=manualUniverseBlock(counts,current)');
  const current=html.indexOf('現在の登録銘柄',manual);
  const rotation=html.indexOf('入れ替え提案',current);
  assert.ok(manual>=0&&current>manual&&rotation>current);
  assert.match(html,/if\(root\.querySelector\('\.universe-manual-card'\)\)return/);
  assert.match(html,/手動追加・固定/);
});

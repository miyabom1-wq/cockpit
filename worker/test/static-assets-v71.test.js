import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const workerRoot=path.resolve(here,'..');

test('Worker deployment includes the VANTAGE frontend as static assets',()=>{
  const toml=fs.readFileSync(path.join(workerRoot,'wrangler.toml'),'utf8');
  assert.match(toml,/\[assets\]/);
  assert.match(toml,/directory\s*=\s*"\.\.\/public"/);
  assert.match(toml,/run_worker_first\s*=\s*\[\s*"\/api\/\*"\s*\]/);
  const html=fs.readFileSync(path.resolve(workerRoot,'../public/index.html'),'utf8');
  assert.match(html,/UI v73/);
  assert.match(html,/vantage-ui73\.8\.9-universe-finish-20260821/);
  assert.match(html,/themeClassifier='v73-e-split'/);
  assert.doesNotMatch(html,/theme-fixes-v72\.js/);
  assert.doesNotMatch(html,/event-coverage-v56\.js|event-official-v57\.js|event-mobile-v58\.js/);
  assert.doesNotMatch(html,/vantage-frame-sync-v49\.js|reliability-fixes-v5[34]\.js|navigation-v55\.js|event-mobile-v59\.js/);
  for(const file of ['frame-sync.js','reliability-sync.js','event-resilience.js','navigation.js','events-ui.js']) assert.match(html,new RegExp(file.replace('.','\\.')));
});

test('mobile UI keeps names readable and event timing compact',()=>{
  const html=fs.readFileSync(path.resolve(workerRoot,'../public/index.html'),'utf8');
  const events=fs.readFileSync(path.resolve(workerRoot,'../public/events-ui.js'),'utf8');
  assert.match(html,/mobileLayout='v73\.8\.9-universe-finish'/);
  assert.match(html,/min-width:160px/);
  assert.match(html,/min-width:180px/);
  assert.match(events,/24h以内/);
  assert.doesNotMatch(events,/時刻欄は「時間未公表」と表示/);
});

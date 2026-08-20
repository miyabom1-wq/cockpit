import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const workerRoot=path.resolve(here,'..');
const html=fs.readFileSync(path.resolve(workerRoot,'../public/index.html'),'utf8');
const routes=fs.readFileSync(path.resolve(workerRoot,'src/api/routes.js'),'utf8');
const stage=fs.readFileSync(path.resolve(workerRoot,'src/services/stage.js'),'utf8');
const http=fs.readFileSync(path.resolve(workerRoot,'src/api/http.js'),'utf8');

test('registered list exposes VANTAGE analysis independent of candidate visibility',()=>{
  assert.match(html,/function openRegisteredAnalysis\(market,symbol,name\)/);
  assert.match(html,/class="small primary universe-analyze"/);
  assert.match(html,/候補画面に出ていないD\/E銘柄でも/);
});

test('registered analysis can hand off the analyzed row to FRAME and watch',()=>{
  assert.match(html,/registeredAnalysis:\{\}/);
  assert.match(html,/const analyzed=state\.registeredAnalysis\?\.\[key\];if\(analyzed\)return analyzed;/);
  assert.match(html,/function addWatchFromRegisteredAnalysis\(symbol,name,market\)/);
  assert.match(html,/source:'registered',signal_snapshot:snap/);
  assert.match(html,/FRAMEで判定/);
});

test('stock-analysis endpoint only analyzes registered symbols',()=>{
  assert.match(routes,/p==='\/api\/stock-analysis'/);
  assert.match(routes,/await getStockList\(env,market\)/);
  assert.match(routes,/登録銘柄ではありません/);
  assert.match(routes,/analyzeRegisteredSymbolNow/);
  assert.match(stage,/export async function analyzeRegisteredSymbolNow/);
  assert.match(stage,/stage\.stocks\?\.\[key\]/);
  assert.match(stage,/deriveContext\(\[\.\.\.peers,a\],ranking,m\)/);
  assert.match(http,/\/api\/stock-analysis/);
});

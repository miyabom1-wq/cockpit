import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('function heatState('),html.indexOf('\nfunction eventShortDate('));
const ctx=vm.createContext({esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),num:n=>String(n)});vm.runInContext(code,ctx);
test('frontend renders Worker states and old payload waits without recomputing extension',()=>{
 const text=ctx.momentumHtml({div25:20,rsi14:95});assert.match(text,/更新待ち/);assert.doesNotMatch(text,/極端な拡張|過熱/);
 const active=ctx.momentumHtml({extensionLabel:'極端な拡張',momentumState:'acceleration',momentumLabel:'加速',entryAssessment:'SIZE_CAUTION',holdingAssessment:'HOLD',momentumEvidence:{reasons:['5MA維持'],rs5Delta:1},momentumProvisional:true});
 assert.match(active,/継続/);assert.match(active,/サイズ注意/);assert.match(active,/場中暫定/);assert.match(active,/momentum-panel positive/);
});
test('compound caution displays separate holding and entry assessments',()=>{const out=ctx.momentumHtml({momentumState:'climax',momentumLabel:'クライマックス警戒',entryAssessment:'AVOID',holdingAssessment:'REDUCE_REVIEW'});assert.match(out,/momentum-panel caution/);assert.match(out,/見送り/);assert.match(out,/縮小・ストップ確認/)});
test('untrusted evidence is escaped and layout wraps',()=>{assert.doesNotMatch(ctx.momentumHtml({momentumEvidence:{reasons:['<img src=x onerror=alert(1)>']}}),/<img/);assert.match(html,/\.momentum-panel .*flex-wrap:wrap/)});

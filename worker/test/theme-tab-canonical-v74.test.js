import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../../public/index.html',import.meta.url),'utf8');
const match=html.match(/function themeGroupsForScope\(scope\)\{[\s\S]*?\r?\n\}\r?\nasync function loadThemeRadar/);
assert.ok(match,'themeGroupsForScope source not found');

const source=match[0].replace(/\r?\nasync function loadThemeRadar[\s\S]*$/,'');
const rows={
  jp:[{symbol:'5803.T',theme:'電線・AI物理',rs5:4,rs20:1,entry_lane:'A'}],
  us:[{symbol:'VRT',theme:'電線・AI物理',rs5:8,rs20:2,entry_lane:'A'}],
};
const ctx={
  state:{momentum:{jp:{rows:rows.jp},us:{rows:rows.us}}},
  themeName:r=>r.theme,
  balancedThemePhase:(jp,us)=>({
    code:'EXPANSION',label:'拡大',kind:'good',reason:'世界横断で拡大',
    provisional:false,propagation:'日米同時',coverage:'日米確認',
    n:2,a:2,b:0,c:0,e:0,rs5:6,rs20:1.5,vol:1.2,breadth:100,hot:0,improving:100,
    abRate:1,bcRate:0,eRate:0,overheatERate:0,weakERate:0,
    confidence:80,jp_confidence:30,us_confidence:30,
    jp:{n:jp.length,rs5:4},us:{n:us.length,rs5:8},
  }),
  themePhase:localRows=>({
    code:'HOLD',label:'判定保留',kind:'neutral',reason:'地域母数不足',
    provisional:false,propagation:'単独',coverage:'地域のみ',
    n:localRows.length,a:localRows.length,b:0,c:0,e:0,
    rs5:localRows[0].rs5,rs20:localRows[0].rs20,vol:1.1,breadth:100,hot:0,improving:100,
    abRate:1,bcRate:0,eRate:0,overheatERate:0,weakERate:0,
    confidence:30,
  }),
};
vm.createContext(ctx);
vm.runInContext(source,ctx);

const global=ctx.themeGroupsForScope('global')[0];
const jp=ctx.themeGroupsForScope('jp')[0];
const us=ctx.themeGroupsForScope('us')[0];

test('JP/US tabs use the global phase label but retain regional metrics',()=>{
  assert.equal(global.phase.label,'拡大');
  assert.equal(jp.phase.label,'拡大');
  assert.equal(us.phase.label,'拡大');

  assert.equal(jp.local_phase.label,'判定保留');
  assert.equal(us.local_phase.label,'判定保留');

  assert.equal(jp.phase.rs5,4);
  assert.equal(us.phase.rs5,8);
  assert.equal(global.phase.rs5,6);
  assert.equal(jp.phase.confidence,80);
  assert.equal(us.phase.confidence,80);

  assert.deepEqual(Array.from(jp.rows,r=>r.symbol),['5803.T']);
  assert.deepEqual(Array.from(us.rows,r=>r.symbol),['VRT']);
});

test('old regional phase branch is gone',()=>{
  assert.ok(!source.includes("scope==='global'?balancedThemePhase(g.jp,g.us):themePhase(g[scope])"));
  assert.ok(source.includes('const canonical=balancedThemePhase(g.jp,g.us);'));
});
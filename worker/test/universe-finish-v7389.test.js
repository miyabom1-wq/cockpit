import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.resolve(here,'../../public/index.html'),'utf8');

function between(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,`missing range ${start} -> ${end}`);
 return html.slice(a,b);
}

test('registered-stock cards keep actions inside a bounded grid on desktop and mobile',()=>{
 assert.match(html,/grid-template-areas:"main meta" "main actions" "note note"/);
 assert.match(html,/grid-template-areas:"main" "meta" "actions" "note"/);
 assert.match(html,/class="universe-stock-main"/);
 assert.match(html,/class="universe-stock-meta"/);
 assert.match(html,/class="universe-stock-actions"/);
 assert.doesNotMatch(html,/\/\* v73\.8\.5 registered analysis \*\//);
});

test('lookup decides registered state from canonical stocklist, not stale rendered state',()=>{
 const block=between('async function lookupUniverseSymbol(){','async function addUniverseLookup(){');
 assert.match(block,/Promise\.all\(\[/);
 assert.match(block,/\/api\/stocklist\?market=/);
 assert.match(block,/stocklist\?\.list\|\|\[\]/);
 assert.match(block,/const already=Boolean\(existing\)/);
 assert.match(block,/登録済み/);
});

test('manual JP add normalizes the stored name and guards duplicates',()=>{
 const block=between('async function addUniverseLookup(){','async function deleteUniverseFromButton(button){');
 assert.match(block,/if\(x\.already\)\{toast\('すでに登録済みです'\);return\}/);
 assert.match(block,/window\.resolveJapaneseName\(x\.symbol,name\)/);
 assert.match(block,/日本語名を入力してください/);
 assert.match(block,/name,pinned:true/);
});

test('refresh proposal is followed by a full universe GET before rendering counts and current lists',()=>{
 const block=between('async function loadUniverse(refresh=false){','async function refreshUniverse(){');
 const post=block.indexOf("body:{action:'refresh'}");
 const get=block.indexOf("const d=await api('/api/universe')");
 assert.ok(post>=0,'refresh POST missing');
 assert.ok(get>post,'dashboard GET must follow refresh POST');
 assert.match(block,/counts=d\.counts\|\|\{\}/);
 assert.match(block,/current=d\.current\|\|\{\}/);
});

test('existing Japanese-name helper is explicitly exported for registered-stock UI',()=>{
 assert.match(html,/window\.preferredLocalName=preferredLocalName;/);
 assert.match(html,/window\.resolveJapaneseName=resolveJapaneseName;/);
});

test('registered analysis and FRAME/watch handoff remain present',()=>{
 assert.match(html,/async function openRegisteredAnalysis\(market,symbol,name\)/);
 assert.match(html,/FRAMEで判定/);
 assert.match(html,/addWatchFromRegisteredAnalysis/);
 assert.match(html,/state\.registeredAnalysis/);
});

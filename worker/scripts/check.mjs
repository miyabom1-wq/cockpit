import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
const targets=files(resolve('src')).filter(x=>x.endsWith('.js'));
for(const file of targets){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
const html=readFileSync(resolve('../public/index.html'),'utf8'),blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
const temp=resolve('.check-frontend.tmp.js');writeFileSync(temp,blocks.join('\n'));
try{const r=spawnSync(process.execPath,['--check',temp],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}finally{try{unlinkSync(temp)}catch{}}
const sw=spawnSync(process.execPath,['--check',resolve('../public/sw.js')],{stdio:'inherit'});if(sw.status!==0)process.exit(sw.status||1);
console.log(`syntax ok: ${targets.length} worker files + frontend + service worker`);

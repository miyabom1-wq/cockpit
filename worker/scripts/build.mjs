import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worker=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(worker,'..');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
// ZIP distributions also build without a Git checkout. Identify those by contents.
function archiveIdentity(){
  const hash=createHash('sha256');
  function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=resolve(dir,e.name);if(e.isDirectory())walk(file);else{hash.update(relative(root,file).split(sep).join('/'));hash.update(readFileSync(file));}
  }}
  for(const dir of ['src','scripts'])walk(resolve(worker,dir));
  walk(resolve(root,'public'));
  for(const name of ['package.json','package-lock.json','wrangler.toml'])hash.update(readFileSync(resolve(worker,name)));
  return 'archive-'+hash.digest('hex').slice(0,16);
}
let sourceCommit;
try{
  if(resolve(git('rev-parse','--show-toplevel'))!==root)throw Error('not the project repository');
  sourceCommit=git('rev-parse','HEAD')+(git('status','--porcelain','--untracked-files=normal','--','worker','public')?'-dirty':'');
}catch{sourceCommit=archiveIdentity();}
const buildTime=new Date().toISOString();
const result=await build({
  stdin:{contents:"export { default, WriteBudget } from './worker/src/index.js';",loader:'js'},
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',
  define:{__VANTAGE_SOURCE_COMMIT__:JSON.stringify(sourceCommit),__VANTAGE_BUILD_TIME__:JSON.stringify(buildTime)},
  // All source imports are local JS. Resolve them explicitly so packaging does
  // not inspect unrelated parent directories or inherit parent tsconfig files.
  plugins:[{name:'local-worker-source',setup(builder){
    builder.onResolve({filter:/.*/},args=>{
      if(!args.path.startsWith('.'))throw Error('Unexpected non-local import: '+args.path);
      const file=resolve(args.namespace==='worker-source'?dirname(args.importer):root,args.path);
      if(relative(root,file).startsWith('..'+sep))throw Error('Import outside repository');
      return {path:file,namespace:'worker-source'};
    });
    builder.onLoad({filter:/.*/,namespace:'worker-source'},async args=>({contents:await readFile(args.path,'utf8'),loader:'js'}));
  }}],
});
const output=resolve(worker,'.wrangler/release');
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'index.js'),result.outputFiles[0].contents);
await writeFile(resolve(output,'build.json'),JSON.stringify({source_commit:sourceCommit,build_time:buildTime},null,2)+'\n');
console.log(`Built ${sourceCommit} at ${buildTime}`);

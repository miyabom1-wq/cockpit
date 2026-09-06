import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(worker,'..');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,encoding:'utf8'}).trim();
const commit=git('rev-parse','HEAD');
const dirty=!!git('status','--porcelain','--untracked-files=normal','--','worker','public');
const buildTime=new Date().toISOString();
const sourceCommit=commit+(dirty?'-dirty':'');
const result=await build({
  stdin:{contents:"export { default } from './worker/src/index.js';",loader:'js'},
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

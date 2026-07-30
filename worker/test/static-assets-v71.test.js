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
  assert.match(html,/UI v71/);
});

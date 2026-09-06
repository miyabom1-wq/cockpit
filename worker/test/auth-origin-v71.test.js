import test from 'node:test';
import assert from 'node:assert/strict';
import { authorized, requiresAuthorization } from '../src/api/http.js';

const env={WRITE_TOKEN:'rotated-secret'};

test('official frontend works without entering a key after token rotation',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist',{
    headers:{Origin:'https://miyabom1-wq.github.io'}
  });
  assert.equal(requiresAuthorization(req,new URL(req.url)),true);
  assert.equal(authorized(req,env),true);
});

test('same-origin Worker frontend works without entering a key after token rotation',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/positions',{
    headers:{Origin:'https://cockpit-backend.miyab.workers.dev'}
  });
  assert.equal(authorized(req,env),true);
});


test('installed same-origin PWA works without entering a key when Origin is omitted',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist',{
    headers:{'Sec-Fetch-Site':'same-origin'}
  });
  assert.equal(authorized(req,env),true);
});

test('same-origin referer fallback works without entering a key when Origin is omitted',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/positions',{
    headers:{Referer:'https://cockpit-backend.miyab.workers.dev/'}
  });
  assert.equal(authorized(req,env),true);
});

test('same-origin browser writes do not require a manually entered key',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist',{
    method:'POST',headers:{Origin:'https://cockpit-backend.miyab.workers.dev'}
  });
  assert.equal(authorized(req,env),true);
});

test('non-frontend API client still needs an API key',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist');
  assert.equal(authorized(req,env),false);
});

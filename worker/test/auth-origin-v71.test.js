import test from 'node:test';
import assert from 'node:assert/strict';
import { authorized, requiresAuthorization } from '../src/api/http.js';

const env={WRITE_TOKEN:'rotated-secret'};

test('official frontend can read private panels after token rotation',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist',{
    headers:{Origin:'https://miyabom1-wq.github.io'}
  });
  assert.equal(requiresAuthorization(req,new URL(req.url)),true);
  assert.equal(authorized(req,env),true);
});

test('same-origin Worker frontend can read private panels after token rotation',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/positions',{
    headers:{Origin:'https://cockpit-backend.miyab.workers.dev'}
  });
  assert.equal(authorized(req,env),true);
});

test('write operations still require the token',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist',{
    method:'POST',headers:{Origin:'https://cockpit-backend.miyab.workers.dev'}
  });
  assert.equal(authorized(req,env),false);
});

test('non-frontend API client cannot read private panels',()=>{
  const req=new Request('https://cockpit-backend.miyab.workers.dev/api/watchlist');
  assert.equal(authorized(req,env),false);
});

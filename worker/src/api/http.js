import { FRONTEND_ORIGIN } from '../config.js';

export function corsHeaders(request){
  const origin=request?.headers?.get('Origin')||'';
  const allow=origin===FRONTEND_ORIGIN||origin.startsWith('http://localhost:')?origin:'*';
  return{
    'Access-Control-Allow-Origin':allow,
    'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, X-Vantage-Key',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin'
  };
}

export function json(data,status=200,request=null){
  return new Response(JSON.stringify(data),{
    status,
    headers:{'Content-Type':'application/json; charset=utf-8',...corsHeaders(request)}
  });
}

const PRIVATE_READS=new Set([
  '/api/export','/api/watchlist','/api/positions','/api/discipline-state',
  '/api/events','/api/signal-log','/api/stocklist','/api/push/key'
]);

const WRITE_GETS=new Set([
  '/api/stage-run','/api/signal-log-capture','/api/push/test',
  '/api/backtest-run','/api/migrate','/api/theme-history-capture'
]);

function trustedFrontend(request){
  const origin=request.headers.get('Origin')||'';
  const requestOrigin=new URL(request.url).origin;
  if(origin===FRONTEND_ORIGIN||origin===requestOrigin||origin.startsWith('http://localhost:'))return true;

  // Same-origin GET fetches (especially installed PWAs) may omit Origin.
  // Sec-Fetch-Site is browser-controlled and lets the official Worker-hosted
  // frontend read private panels without weakening mutation authorization.
  const fetchSite=(request.headers.get('Sec-Fetch-Site')||'').toLowerCase();
  if(!origin&&fetchSite==='same-origin')return true;

  // Fallback for browsers/webviews that omit Sec-Fetch-Site but send Referer.
  const referer=request.headers.get('Referer')||'';
  if(!origin&&referer.startsWith(requestOrigin+'/'))return true;
  return false;
}

function suppliedTokenMatches(request,env){
  const token=String(env.WRITE_TOKEN||'');
  const supplied=request.headers.get('X-Vantage-Key')||'';
  return Boolean(token)&&supplied===token;
}

export function requiresAuthorization(request,url){
  const method=String(request.method||'GET').toUpperCase();
  if(['POST','PUT','DELETE'].includes(method))return true;
  return PRIVATE_READS.has(url.pathname)||WRITE_GETS.has(url.pathname)||url.searchParams.get('refresh')==='1';
}

export function authorized(request,env){
  const url=new URL(request.url);
  if(!requiresAuthorization(request,url))return true;
  if(suppliedTokenMatches(request,env))return true;

  const method=String(request.method||'GET').toUpperCase();
  // Read-only personal panels remain available from the official frontend
  // even if WRITE_TOKEN was rotated. Mutations and manual refresh operations
  // still require the token whenever it is configured.
  if(method==='GET'&&PRIVATE_READS.has(url.pathname)&&trustedFrontend(request))return true;

  const token=String(env.WRITE_TOKEN||'');
  if(!token&&trustedFrontend(request))return true;
  return false;
}

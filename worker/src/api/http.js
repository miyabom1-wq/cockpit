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
  '/api/events','/api/signal-log','/api/stocklist','/api/stock-analysis','/api/push/key','/api/universe'
]);

const WRITE_GETS=new Set([
  '/api/stage-run','/api/signal-log-capture','/api/push/test',
  '/api/backtest-run','/api/migrate','/api/theme-history-capture','/api/events-sync'
]);

const MUTABLE_PATHS=new Set(['/api/events','/api/positions','/api/discipline-state','/api/watchlist','/api/stocklist','/api/signal-log','/api/universe']);
const POST_ONLY=new Set(['/api/events-sync','/api/push/subscribe','/api/push/unsubscribe']);

export function allowedMethods(path){
  if(POST_ONLY.has(path))return ['POST'];
  if(MUTABLE_PATHS.has(path))return ['GET','POST','PUT','DELETE'];
  if(WRITE_GETS.has(path))return ['GET','POST'];
  return ['GET'];
}

function suppliedTokenMatches(request,env){
  const token=String(env.WRITE_TOKEN||'');
  const supplied=request.headers.get('X-Vantage-Key')||'';
  if(!token||supplied.length!==token.length)return false;
  let difference=0;
  for(let i=0;i<token.length;i++)difference|=token.charCodeAt(i)^supplied.charCodeAt(i);
  return difference===0;
}

export function requiresAuthorization(request,url){
  const method=String(request.method||'GET').toUpperCase();
  if(method!=='GET')return true;
  return PRIVATE_READS.has(url.pathname)||WRITE_GETS.has(url.pathname)||url.searchParams.get('refresh')==='1';
}

// Browser-origin compatibility is not user identity authentication. The owner
// explicitly chose keyless use of the existing application. External API
// clients can continue to authenticate with WRITE_TOKEN.
function fromFrontend(request){
  const ownOrigin=new URL(request.url).origin;
  const allowed=origin=>origin===ownOrigin||origin===FRONTEND_ORIGIN;
  const origin=request.headers.get('Origin');
  if(origin)return allowed(origin);
  const referer=request.headers.get('Referer');
  if(referer){try{if(!allowed(new URL(referer).origin))return false;}catch{return false;}}
  return request.headers.get('Sec-Fetch-Site')==='same-origin'||Boolean(referer);
}

export function authorized(request,env){
  const url=new URL(request.url);
  if(!requiresAuthorization(request,url))return true;
  return fromFrontend(request)||suppliedTokenMatches(request,env);
}

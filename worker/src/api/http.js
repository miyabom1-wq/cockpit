import { FRONTEND_ORIGIN } from '../config.js';
export function corsHeaders(request){const origin=request?.headers?.get('Origin')||'',allow=origin===FRONTEND_ORIGIN||origin.startsWith('http://localhost:')?origin:'*';return{'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Vantage-Key','Access-Control-Max-Age':'86400','Vary':'Origin'};}
export function json(data,status=200,request=null){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...corsHeaders(request)}});}
const PRIVATE_READS=new Set(['/api/export','/api/watchlist','/api/positions','/api/discipline-state','/api/events','/api/signal-log','/api/stocklist','/api/push/key']);
export function requiresAuthorization(request,url){
  if(['POST','PUT','DELETE'].includes(request.method))return true;
  return PRIVATE_READS.has(url.pathname)||['/api/stage-run','/api/signal-log-capture','/api/push/test','/api/backtest-run','/api/migrate'].includes(url.pathname)||url.searchParams.get('refresh')==='1';
}
export function authorized(request,env){const url=new URL(request.url);if(!requiresAuthorization(request,url))return true;const token=String(env.WRITE_TOKEN||''),supplied=request.headers.get('X-Vantage-Key')||'';if(token)return supplied===token;const origin=request.headers.get('Origin')||'';return origin===FRONTEND_ORIGIN||origin.startsWith('http://localhost:');}

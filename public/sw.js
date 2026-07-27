'use strict';
const BUILD='vantage-stable-v63d-api-bypass-20260727';
const CACHE='vantage-stable-v63d-api-bypass';
const SHELL=[
 './?build='+BUILD,
 './vantage-runtime-v63.js?build='+BUILD,
 './manifest.json?build='+BUILD,
 './version.json',
 './icon-v45-192.png',
 './icon-v45-512.png',
 './icon-v45-maskable-192.png',
 './icon-v45-maskable-512.png',
 './icon-badge.png',
 './apple-touch-icon-v45.png'
];

async function putCache(request,response){
 if(!response||!response.ok)return response;
 const cache=await caches.open(CACHE);
 await cache.put(request,response.clone());
 return response;
}
async function networkFirst(request){
 try{
  const response=await fetch(new Request(request,{cache:'no-store'}));
  return await putCache(request,response);
 }catch(error){
  const cached=await caches.match(request);
  if(cached)return cached;
  throw error;
 }
}
async function cacheFirst(request){
 const cached=await caches.match(request);
 if(cached)return cached;
 const response=await fetch(request);
 return putCache(request,response);
}

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(async url=>{
   const request=new Request(url,{cache:'reload'});
   const response=await fetch(request);
   if(response.ok)await cache.put(request,response);
  }));
  await self.skipWaiting();
 })());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('vantage-')&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const windowClient of windows)windowClient.postMessage({type:'VANTAGE_BUILD_ACTIVE',build:BUILD});
 })());
});

self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 const destination=request.destination;
 const isNavigation=request.mode==='navigate'||(request.headers.get('accept')||'').includes('text/html');
 const isMutable=isNavigation||destination==='script'||destination==='style'||url.pathname.endsWith('.json');
 event.respondWith(isMutable?networkFirst(request):cacheFirst(request));
});

self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?event.data.json():{}}
 catch{data={body:event.data?event.data.text():''}}
 event.waitUntil(self.registration.showNotification(data.title||'VANTAGE',{
  body:data.body||'',
  icon:'./icon-v45-192.png',
  badge:'./icon-badge.png',
  tag:data.tag||'vantage-index',
  renotify:true,
  data:data.url||'./'
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=event.notification.data||'./';
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  for(const windowClient of windows)if('focus'in windowClient)return windowClient.focus();
  return clients.openWindow?clients.openWindow(target):null;
 }));
});

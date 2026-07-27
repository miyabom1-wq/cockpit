'use strict';
const BUILD='vantage-stable-v63h-runtime-recovery-20260727';
const NETWORK_MODE='notification-only';

self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(name=>name.startsWith('vantage-')).map(name=>caches.delete(name)));
  await self.clients.claim();
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const windowClient of windows)windowClient.postMessage({type:'VANTAGE_RUNTIME_ACTIVE',build:BUILD,network:NETWORK_MODE});
 })());
});

self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
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

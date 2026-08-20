'use strict';
const BUILD='vantage-ui73.8.5-registered-analysis-20260821';
const NETWORK_MODE='notification-only';

self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('vantage-')).map(name=>caches.delete(name)));
  await self.clients.claim();
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
  icon:'./icon-192.png',
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

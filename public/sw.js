const CACHE='vantage-universe-ui-20260717-v41';
const SHELL=['./manifest.json','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./icon-badge.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>null).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request,url=new URL(req.url);if(req.method!=='GET')return;
 if(url.href.includes('/api/')){e.respondWith(fetch(req,{cache:'no-store'}));return;}
 const html=req.mode==='navigate'||(req.headers.get('accept')||'').includes('text/html');
 if(html){e.respondWith(fetch(new Request(req,{cache:'reload'})).catch(()=>caches.match(req)));return;}
 e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok&&url.origin===self.location.origin)caches.open(CACHE).then(c=>c.put(req,res.clone()));return res;})));
});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{d={body:e.data?e.data.text():''}}e.waitUntil(self.registration.showNotification(d.title||'VANTAGE',{body:d.body||'',icon:'./icon-192.png',badge:'./icon-badge.png',tag:d.tag||'vantage-index',renotify:true,data:d.url||'./'}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const target=e.notification.data||'./';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws)if('focus'in w)return w.focus();return clients.openWindow?clients.openWindow(target):null;}));});

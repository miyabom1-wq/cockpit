/* VANTAGE Service Worker
 * 役割:
 *   1) PWA / TWA の「インストール可能」要件を満たす（fetchハンドラ必須）
 *   2) アプリの外枠（アイコン・manifest）をキャッシュしてオフライン起動を補助
 *
 * 重要:
 *   - /api/ は絶対にキャッシュしない
 *   - HTML(index.html / /) は常にネットワーク優先 + cache: reload
 *   - index.html は事前キャッシュしない（古いUIが残る事故を避ける）
 */

const CACHE_VERSION = 'vantage-v24-signal-auto-capture';
const APP_SHELL = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon-badge.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // API通信は常にネットワーク。古い株価・状態を掴ませない。
  if (url.pathname.startsWith('/api/') || url.href.includes('/api/')) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => Response.error()));
    return;
  }

  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  // HTMLは必ずネットワーク優先。古いindex.htmlを出さない。
  if (isNav) {
    event.respondWith(
      fetch(new Request(req, { cache: 'reload' })).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 画像・manifestなどはキャッシュ優先。なければ取得。
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => Response.error());
    })
  );
});

/* === Push通知（指数regime trigger用） === */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'VANTAGE', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'VANTAGE', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-badge.png',
      tag: data.tag || 'vantage-index',
      renotify: true,
      data: data.url || './'
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

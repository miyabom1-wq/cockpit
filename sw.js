/* VANTAGE Service Worker
 * 役割:
 *   1) PWA / TWA の「インストール可能」要件を満たす（fetchハンドラ必須）
 *   2) アプリの外枠（HTML/CSS/アイコン）をキャッシュしてオフラインでも起動できる
 * 設計判断:
 *   - /api/ は絶対キャッシュしない（常に最新）
 *   - HTMLナビゲーションは network-first（最新の画面を必ず取りに行く。
 *     取れない時だけキャッシュにフォールバック）→ GitHub更新が即アプリに反映される
 *   - 静的アセット（アイコン等）は cache-first（変わらないので高速起動優先）
 */
const CACHE_VERSION = 'vantage-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール: app shellを事前キャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// 有効化: 古いバージョンのキャッシュを掃除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // --- API: 必ずネットワーク優先（キャッシュしない） ---
  if (url.pathname.startsWith('/api/') || url.href.includes('/api/')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // --- HTMLナビゲーション: network-first（最新の画面を取りに行く） ---
  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  // --- その他の静的アセット: cache-first（高速起動） ---
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* === Push通知（Phase 3後半で有効化）===
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'VANTAGE', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: data.url || './'
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || './'));
});
*/

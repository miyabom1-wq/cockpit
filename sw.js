/* VANTAGE Service Worker
 * 役割:
 *   1) PWA / TWA の「インストール可能」要件を満たす（fetchハンドラ必須）
 *   2) アプリの外枠（HTML/CSS/アイコン）をキャッシュしてオフラインでも起動できる
 * 重要な設計判断:
 *   - /api/ への通信は絶対にキャッシュしない（株価・状態は常に最新が必要）
 *     → ネットワーク優先。古い価格を掴ませない＝「データ事故ゼロ」の哲学に一致
 *   - アプリの殻（app shell）だけキャッシュ優先で即起動
 */

const CACHE_VERSION = 'vantage-v1';
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
      .catch(() => self.skipWaiting()) // アイコン未配置でも止めない
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

  // GET以外は素通し
  if (req.method !== 'GET') return;

  // --- API通信: 必ずネットワーク優先（キャッシュしない） ---
  if (url.pathname.startsWith('/api/') || url.href.includes('/api/')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // --- app shell: キャッシュ優先、無ければ取得してキャッシュ ---
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // 同一オリジンの正常レスポンスのみキャッシュ
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* === Phase 3で Push通知を実装する際、ここに push / notificationclick を追加する ===
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

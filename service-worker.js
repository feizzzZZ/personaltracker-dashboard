// Finance OS — Service Worker v2
// Cache strategy: Cache-first for shell, Network-first for CDN

const CACHE_NAME = 'finance-os-v29';  // bump version so old cache is cleared on deploy
const BASE = '/personaltracker-dashboard';

// App shell — files to pre-cache on install
const SHELL_FILES = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/investment-analysis.html',  // was missing — caused offline failure on nav
  BASE + '/shared.js',                 // data layer กลาง — ต้อง precache ให้ offline ทำงาน
  BASE + '/manifest.json',
  BASE + '/icon-192x192.png',
  BASE + '/icon-512x512.png',
];

// CDN assets — cache on first use
// Font URL must match the exact href used in <link> tags so cache hits work
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  // Google Fonts: cache the CSS endpoint; actual font files are cached on first use below
  'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Mono:wght@300;400;500&display=swap',
];

// ── Install: pre-cache app shell ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching shell');
      return cache.addAll(SHELL_FILES);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache or network ───────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Skip non-GET and cross-origin except CDN
  if (event.request.method !== 'GET') return;

  // CDN assets: cache-first (they rarely change)
  if (CDN_ASSETS.some(cdn => url.startsWith(cdn)) || url.includes('fonts.g')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // HTML/navigation: NETWORK-FIRST — deploy แล้วเห็นเวอร์ชันใหม่ทันที
  // (cache ใช้เฉพาะตอน offline) แก้ปัญหา "hard reload ทุกครั้งหลัง deploy" ถาวร
  const cleanUrl = url.split('?')[0];
  const isHTML = event.request.mode === 'navigate' || cleanUrl.endsWith('.html')
              || cleanUrl.endsWith('.json');   // market-data.json เปลี่ยนทุกวัน — ห้ามติด cache
  if (isHTML && (url.includes(BASE) || url.includes(self.location.origin))) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then(c => c || caches.match(BASE + '/index.html')))
    );
    return;
  }

  // Static assets อื่นๆ: cache-first (เร็ว, เปลี่ยนไม่บ่อย)
  if (url.includes(BASE) || url.includes(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match(BASE + '/index.html'));
      })
    );
  }
});

// ── Message: force refresh ────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

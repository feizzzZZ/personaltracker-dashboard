// Finance OS — Service Worker v1
// Cache strategy: Cache-first for shell, Network-first for CDN

const CACHE_NAME = 'finance-os-v1';
const BASE = '/personaltracker-dashboard';

// App shell — files to pre-cache on install
const SHELL_FILES = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/pwa-icons/icon-192x192.png',
  BASE + '/pwa-icons/icon-512x512.png',
];

// CDN assets — cache on first use
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Google+Sans:wght@300;400;500;600;700&family=Google+Sans+Mono:wght@300;400;500&display=swap',
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

  // App shell: cache-first, fallback to index.html for SPA navigation
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

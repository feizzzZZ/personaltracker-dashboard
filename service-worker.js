// Finance OS — Service Worker v2
// Cache strategy: Cache-first for shell, Network-first for CDN

// ══════════════════════════════════════════════════════════════════════
// v45 — bug ที่ทำให้ Sync ล้มและหน้า Debt โชว์ ฿0
// ══════════════════════════════════════════════════════════════════════
// อาการ: index.html เวอร์ชันใหม่ + shared.js เวอร์ชันเก่า ทำงานคู่กัน
//   → resolvePrices / parseReconcileRows is not defined  (Sync ล้ม)
//   → r.intBal เป็น undefined → fmt(NaN) = ฿0  (ดอกเบี้ยไม่ขยับเวลาแก้ APR)
//
// ต้นเหตุ: `.html`/`.json` เป็น network-first (เห็นของใหม่ทันที) แต่ `.js`
// ตกไปเข้า cache-first ด้านล่าง ถ้า CACHE_NAME ไม่เปลี่ยน shared.js เก่า
// จะถูกเสิร์ฟจาก cache ตลอดไป — และมันเงียบ ไม่มี error ตอนโหลด
//
// แก้ 2 ชั้น:
//   1. bump CACHE_NAME (แก้เฉพาะหน้า)
//   2. ย้าย shared.js ไป network-first เหมือน HTML (แก้ถาวร)
//      เหตุผล: shared.js คือ data layer ที่ index.html เรียกใช้โดยตรง
//      สองไฟล์นี้ต้องมาจาก deploy เดียวกันเสมอ ไม่มีข้อยกเว้น
const CACHE_NAME = 'finance-os-v45';  // bump version so old cache is cleared on deploy
const BASE = '/personaltracker-dashboard';

// App shell — files to pre-cache on install
const SHELL_FILES = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/investment-analysis.html',  // was missing — caused offline failure on nav
  BASE + '/shared.js',                 // data layer กลาง — ต้อง precache ให้ offline ทำงาน
  BASE + '/manifest.json',
  BASE + '/icon/icon-192x192.png',
  BASE + '/icon/icon-512x512.png',
];

// CDN assets — cache on first use
// Font URL must match the exact href used in <link> tags so cache hits work
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  // Google Fonts: cache the CSS endpoint; actual font files are cached on first use below.
  // #1/#9 — MUST stay byte-identical to the href in both HTML files or the cache
  // never hits. The old entry pointed at Google Sans / Google Sans Mono, which are
  // Google-internal fonts that fonts.googleapis.com does not serve: the request
  // 400'd, so this was caching a failure and Thai text had no font offline.
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
];

// ── Install: pre-cache app shell ──────────────────────────────────────
// v40 FIX: เดิมใช้ cache.addAll() ซึ่งเป็น all-or-nothing —
// ถ้าไฟล์ใดไฟล์หนึ่งหาย (เช่น icon-192 ยังไม่ได้ commit) install จะ reject ทั้งชุด
// ผลคือ SW ไม่ติดตั้งเลย → offline พังทั้งแอปแบบเงียบๆ หาสาเหตุไม่เจอ
// เปลี่ยนเป็น cache ทีละไฟล์ ไฟล์ที่หายแค่ข้ามไป พร้อม log บอกว่าไฟล์ไหนหาย
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const missing = [];
      await Promise.all(SHELL_FILES.map(async url => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, res);
          else missing.push(url + ' (HTTP ' + res.status + ')');
        } catch (e) { missing.push(url + ' (' + e.message + ')'); }
      }));
      if (missing.length) console.warn('[SW] ข้ามไฟล์ที่หาไม่เจอ:', missing);
      else console.log('[SW] Pre-cached shell ครบ', SHELL_FILES.length, 'ไฟล์');
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
              || cleanUrl.endsWith('.json')    // market-data.json เปลี่ยนทุกวัน — ห้ามติด cache
              || cleanUrl.endsWith('.js');     // v45: shared.js ต้องเวอร์ชันเดียวกับ index.html เสมอ
  if (isHTML && (url.includes(BASE) || url.includes(self.location.origin))) {
    const isJSON = cleanUrl.endsWith('.json');
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          // v41 #21: market-data.json ถูกเรียกด้วย ?t=<วันที่> กัน cache
          // ถ้าเก็บด้วย Request เต็ม (รวม query) จะได้ entry ใหม่ทุกวันและไม่มีวันถูกลบ
          // → เก็บด้วย URL ที่ตัด query ทิ้ง ให้ทับ entry เดิมเสมอ
          caches.open(CACHE_NAME).then(cache => cache.put(isJSON ? cleanUrl : event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(isJSON ? cleanUrl : event.request).then(c => {
          if (c) return c;
          // v41 #20: ห้ามคืน index.html ให้ request ที่คาดหวัง JSON —
          // ผู้เรียกทำ r.json() แล้วจะได้ SyntaxError "Unexpected token <" ซึ่งหาสาเหตุยาก
          // คืน 504 ให้ตรงไปตรงมาว่าออฟไลน์และไม่มีข้อมูลใน cache
          if (isJSON) {
            return new Response(
              JSON.stringify({ error: 'offline', message: 'ไม่มีข้อมูลใน cache และเชื่อมต่อไม่ได้' }),
              { status: 504, statusText: 'Gateway Timeout',
                headers: { 'Content-Type': 'application/json' } }
            );
          }
          return caches.match(BASE + '/index.html');
        })
      )
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

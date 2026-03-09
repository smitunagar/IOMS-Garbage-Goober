/* ── Garbage Goober Service Worker ───────────────────────────────────────────
   Provides offline fallback and caches static shell assets.
   ─────────────────────────────────────────────────────────────────────────── */
'use strict';

const CACHE_NAME = 'gg-shell-v1';

// Static assets to pre-cache (app shell)
const SHELL_ASSETS = [
  '/css/style.css',
  '/js/waste-scanner.js',
  '/js/app.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/offline',
];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Use individual add calls so one failure doesn't block the rest
      Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url)))
    )
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first with offline fallback ────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle same-origin GET requests
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  // Static assets → cache-first
  const isStatic = /\.(css|js|png|jpg|jpeg|svg|woff2?|ico)(\?.*)?$/.test(request.url);
  if (isStatic) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // HTML / API → network-first, offline fallback for navigation
  event.respondWith(
    fetch(request).catch(() => {
      if (request.mode === 'navigate') {
        return caches.match('/offline') || new Response(
          '<html><body style="font-family:sans-serif;text-align:center;padding:3rem">' +
          '<h2>You\'re offline</h2><p>Please check your internet connection and try again.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      }
    })
  );
});

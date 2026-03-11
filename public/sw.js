/* ── Garbage Goober Service Worker ───────────────────────────────────────────
   Provides offline fallback and caches static shell assets.
   ─────────────────────────────────────────────────────────────────────────── */
'use strict';

// Cache name contains the deploy ID injected by server.js – changes on every deploy
// so old caches are automatically deleted when a new version is pushed.
const CACHE_NAME = 'gg-shell-__DEPLOY_ID__';

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

  // Static assets → stale-while-revalidate
  // Serve from cache immediately (fast), fetch fresh copy in background,
  // update the cache entry → next page load always gets the latest version.
  const isStatic = /\.(css|js|png|jpg|jpeg|svg|woff2?|ico)(\?.*)?$/.test(request.url);
  if (isStatic) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        // Return cached instantly; network fetch updates cache in background
        return cached || networkFetch;
      })
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

// ── Push notification received ──────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data  = event.data ? event.data.json() : {};
  const title = data.title || 'Garbage Goober';
  const body  = data.body  || '';
  const url   = data.url   || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    '/icons/icon-192x192.png',
      badge:   '/icons/icon-192x192.png',
      data:    { url },
      vibrate: [200, 100, 200],
    })
  );
});

// ── Notification click ─────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then(c => c.navigate(url));
      return clients.openWindow(url);
    })
  );
});

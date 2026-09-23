const SHELL_CACHE = 'omnix-shell-v1';
const STATIC_CACHE = 'omnix-static-v1';
const OFFLINE_URL = '/offline';
const SHELL_ASSETS = [
  OFFLINE_URL,
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png',
  '/pwa/apple-touch-icon.png',
  '/omnix-mark.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('omnix-') && ![SHELL_CACHE, STATIC_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

function isPrivateApplicationRequest(request, url) {
  return url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/_next/data/') ||
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-Prefetch');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateApplicationRequest(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (!response.ok || response.type !== 'basic') return response;
        const copy = response.clone();
        void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
  }
});

// Morning brief and alerts (Epic 11). Payloads are end-to-end encrypted by the push
// service; only same-origin paths are ever opened from a notification.
function safeInternalUrl(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' && payload.title ? payload.title.slice(0, 120) : 'Omnix';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 240) : 'Open Omnix to see today.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    tag: typeof payload.tag === 'string' && /^omnix-[a-z0-9-]{1,80}$/.test(payload.tag) ? payload.tag : 'omnix-morning-brief',
    renotify: typeof payload.tag === 'string' && payload.tag.startsWith('omnix-new-lead'),
    data: { url: safeInternalUrl(payload.url) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safeInternalUrl(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.navigate(target).then((client) => (client || existing).focus());
    return self.clients.openWindow(target);
  }));
});

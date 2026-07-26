const VERSION = 'booboo-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
  ]));
});

// Absichtlich kein Fetch-Cache: private Seiten, Beschwerden und Fotos bleiben immer network-only.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

void VERSION;

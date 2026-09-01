/**
 * Minimal service worker: cache-first for static assets, network-first for
 * lesson data (so content updates reach students, but a flaky connection
 * still plays cached lessons). Registered by the app in production only.
 */
const CACHE = 'ai-tutor-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])));
  // NO skipWaiting HERE, deliberately. A deploy while a student is mid-class
  // would otherwise swap the app out from under them - during the one
  // experience in this product that has to be seamless. The new worker waits
  // until the page asks for it, which the page only does between classes.
});

// The page asks when the student is somewhere safe to reload.
self.addEventListener('message', (event) => {
  if (event.data === 'take-over') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Claiming is correct HERE: by the time a worker activates it has
      // either been asked to take over, or every tab using the old one has
      // already gone.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  const isData = request.url.includes('.json');
  event.respondWith(isData ? networkFirst(request) : cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('offline and uncached');
  }
}

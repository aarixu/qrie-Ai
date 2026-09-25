/**
 * Minimal service worker: cache-first for static assets, network-first for
 * lesson data (so content updates reach students, but a flaky connection
 * still plays cached lessons). Registered by the app in production only.
 */
/**
 * Bumped whenever this file changes, which a deploy does.
 *
 * A constant name plus cache-first was the bug underneath the update
 * problem: the new worker took over, the page reloaded, and the reload was
 * served the OLD index.html out of the cache — which points at the old
 * hashed assets, so the update quietly did not apply.
 */
const CACHE = 'ai-tutor-v3'; // bumped for the Riso re-brand: the activate handler clears v2, so installed clients stop serving amber-era icons

/**
 * The app's root, taken from the worker's own scope rather than assumed to be
 * the origin root. Standalone that is '/'; mounted under the marketing site it
 * is '/app/', and precaching '/' there would store the landing page as this
 * app's offline shell — the wrong document entirely, served first, every time
 * the connection drops.
 */
const ROOT = new URL(self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([ROOT])));
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

  // Navigations go to the network first. The HTML names the hashed assets,
  // so serving a stale one pins the whole app to the previous build; the
  // assets themselves are content-hashed and safe to keep forever.
  const isDocument = request.mode === 'navigate';
  const isData = request.url.includes('.json');
  event.respondWith(isDocument || isData ? networkFirst(request) : cacheFirst(request));
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

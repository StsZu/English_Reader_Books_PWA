/* Service worker: precaches the app shell so the installed PWA starts offline. */
const PRECACHE = __PRECACHE__
const CACHE = 'shell-__VERSION__'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // Network first so a new version arrives on the next launch; the cached shell when offline.
    // The page from the network is not cached here: it may belong to a newer version whose files are not in
    // this cache yet. Each version caches its page together with its files at install (R8).
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]).catch(() => caches.match('./').then((cached) => cached || Response.error())),
    )
    return
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
})

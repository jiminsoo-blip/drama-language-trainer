// 드라마로 배우는 외국어 — offline-first service worker.
// Cache-first for same-origin GET requests (app shell + data/*.json, ~25MB
// dictionaries included). Cross-origin requests are never touched.
const CACHE = 'drama-trainer-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // skip cross-origin

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => {
          // SPA offline fallback: navigations get the cached app shell
          if (req.mode === 'navigate') {
            return caches.match('./index.html', { ignoreSearch: true })
          }
          throw new Error('offline')
        })
    }),
  )
})

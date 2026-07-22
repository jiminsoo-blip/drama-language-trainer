// 드라마로 배우는 외국어 — offline-first service worker.
//
// Update strategy:
// - Navigations (HTML): NETWORK-FIRST so returning visitors always pick up
//   the latest index.html when online; falls back to cache when offline.
// - Static assets (/assets/* content-hashed, /data/*.json, icons): CACHE-FIRST
//   — hashed filenames change per build, and the ~19MB dictionaries should
//   download only once per version.
// - activate deletes every cache that is not the current version, and
//   main.tsx calls registration.update() on load + reloads once on
//   controllerchange so a new SW takes over cleanly.
const CACHE = 'drama-trainer-v2'

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

function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: true }).then(
    (cached) =>
      cached ??
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      }),
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // skip cross-origin

  // navigations / HTML: latest wins when online
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() =>
          caches
            .match('./index.html', { ignoreSearch: true })
            .then((cached) => cached ?? caches.match(req, { ignoreSearch: true })),
        ),
    )
    return
  }

  // hashed static assets, dictionary data, icons: cache-first
  event.respondWith(cacheFirst(req))
})

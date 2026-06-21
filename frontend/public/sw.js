/*
 * Service worker minimale: serve solo a rendere WorkTogether installabile come PWA
 * (icona sul desktop/home, finestra standalone) e a far partire l'app anche offline.
 * NON cache delle chiamate API/WebSocket: i dati passano sempre dalla rete.
 * Gli asset buildati da Vite hanno hash nel nome, quindi sono sicuri da mettere in cache.
 */
const CACHE = 'worktogether-shell-v1'
const SHELL = ['/', '/index.html', '/favicon.png', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Solo same-origin; mai toccare API o WebSocket.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return

  // Navigazioni (apertura app): network-first, fallback alla shell in cache (offline).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    )
    return
  }

  // Asset statici (hash nel nome): cache-first con aggiornamento in background.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(request, copy))
        }
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})

/*
 * The shell, cached.
 *
 * The single loudest signal that something is a website is the white flash and the
 * spinner when it opens. An installed app opens instantly because its shell is already on
 * the device, and it opens at all when the connection is gone.
 *
 * Only the shell is cached. Audio and database calls always go to the network: stale audio
 * would be worse than none, and a cached list of takes would be a lie.
 */

const SHELL = 'estudio-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => cache.addAll(['/', '/index.html', '/icon.svg', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return          // Supabase, ElevenLabs, audio
  if (url.pathname.startsWith('/.netlify/')) return        // functions

  // The page itself: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(SHELL).then(cache => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // Built assets carry a hash in the name, so a hit is always the right file.
  if (url.pathname.startsWith('/assets/') || /\.(svg|png|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(hit => hit ?? fetch(request).then(response => {
        const copy = response.clone()
        caches.open(SHELL).then(cache => cache.put(request, copy))
        return response
      })),
    )
  }
})

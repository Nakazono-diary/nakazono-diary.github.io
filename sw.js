// 電波がなくても開けるように、アプリのファイルをスマホにしまっておく。
// 記録そのものは IndexedDB にあり、ここでは扱わない。よその住所(同期のドライブ)への通信には手を出さない。
const CACHE = 'diary-v0.21.1'
const FILES = ['./', './index.html', './app.js', './store.js', './photo.js', './dom.js', './body.js', './koyomi.js', './koyomiView.js', './kinenbi.js', './places.js', './sync.js', './edition.js', './projects.js', './style.css', './manifest.webmanifest',
  './icons/icon-180.png?v=2', './icons/icon-192.png?v=2', './icons/icon-512.png?v=2']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('diary-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

// 同じ住所のファイルだけ。まずネットから新しいものを取り、取れなければしまってあるものを使う
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)) }
      return res
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  )
})

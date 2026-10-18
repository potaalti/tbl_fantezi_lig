// Ağ öncelikli önbellek: çevrimdışıyken son görülen veriler açılır.
const ONBELLEK = 'tbl-fantezi-v3';
const KABUK = ['./', 'index.html', 'style.css', 'app.js', 'scoring.js', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(adlar => Promise.all(adlar.filter(a => a !== ONBELLEK).map(a => caches.delete(a))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const anahtar = e.request.url.split('?')[0];
  // Tarayıcı önbelleğindeki eski kodu kullanma: her istekte sunucuya güncel mi diye sor
  // (değişmediyse sunucu kısa bir "değişmedi" yanıtı verir). Sayfa gezinmesi değiştirilemez.
  const istek = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(istek)
      .then(yanit => {
        const kopya = yanit.clone();
        caches.open(ONBELLEK).then(c => c.put(anahtar, kopya));
        return yanit;
      })
      .catch(() => caches.match(anahtar))
  );
});

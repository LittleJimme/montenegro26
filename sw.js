/* Offline-schil. Verhoog SHELL bij elke wijziging aan de app; lettertypen staan apart zodat een update ze niet wist. */
const SHELL = 'shell-v9', FONTS = 'fonts-v1';
const CORE = ['./', 'index.html', 'app.css', 'app.js', 'scenes.js', 'data/trip.enc', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png'];

/* Alles of niets: ontbreekt er een kernbestand (kapotte deploy), dan mislukt de installatie en blijft de vorige versie werken.
   De versleutelde reisgegevens horen erbij: zo werkt de app al offline na precies één keer openen. */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* App en reisgegevens: eerst het netwerk, zodat een nieuwe planning meteen binnenkomt; na 3 s (headers én inhoud)
   of bij een foutrespons de laatst bewaarde versie. De querystring telt niet mee in de sleutel. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const key = req.url.split('?')[0];
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(req.url, { signal: ctl.signal, cache: 'no-cache' });
    const body = await res.blob();
    clearTimeout(timer);
    const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    if (res.ok) { cache.put(key, out.clone()); return out; }
    return (await cache.match(key)) || out;
  } catch (e) {
    clearTimeout(timer);
    return (await cache.match(key)) || (await cache.match(key + 'index.html')) || Response.error();
  }
}
/* Lettertypen: direct uit de cache en op de achtergrond verversen; zonder cache hooguit 3 s wachten. */
async function fonts(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3000);
  const net = fetch(req, { signal: ctl.signal }).then(res => { clearTimeout(timer); if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) return e.respondWith(networkFirst(req));
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return e.respondWith(fonts(req));
});

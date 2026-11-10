// Service worker de l'outil « Équilibre alimentaire du foyer » — version 55091bcd
// La page d'abord par le réseau : une nouvelle version déposée en ligne arrive dès l'ouverture ; le cache ne sert
// que hors connexion. Les appels à l'API GitHub (synchronisation) ne passent jamais par ici.
const CACHE = 'equilibre-55091bcd', SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
// seuls les anciens caches de cet outil sont effacés : l'outil NHL, publié à la même adresse github.io, garde les siens
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf('equilibre-') === 0 && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  // navigation : la page sans son ancre ni sa requête (le lien de liaison #lien=… reste dans le navigateur)
  if (r.mode === 'navigate') {
    const clean = u.origin + u.pathname, shell = () => caches.match(clean).then(m => m || caches.match('./index.html'));
    e.respondWith(fetch(clean, { credentials: 'same-origin' }).then(res => {
      if (res && res.ok) {
        const cp = res.clone(); caches.open(CACHE).then(c => c.put(clean, cp));
        return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
      }
      return shell().then(m => m || res);
    }).catch(shell));
    return;
  }
  e.respondWith(fetch(r).then(res => { if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || Response.error())));
});

// Service worker: maakt de app zelf zonder internet beschikbaar.
//
// De app (html, css, js) wordt vooraf opgeslagen en daarna uit de opslag
// geserveerd terwijl op de achtergrond een verse versie wordt opgehaald.
// Reisgegevens lopen hier NIET doorheen: die bewaart de app zelf in IndexedDB,
// zodat ze bij uitloggen of ingetrokken toegang gericht gewist kunnen worden.
const VERSIE = 'v4';
const OPSLAG = `mee-op-reis-${VERSIE}`;
// Foto's van de reisleiding. Een foto verandert nooit, dus eenmaal bewaard is
// altijd goed. De app wist deze opslag bij uitloggen en bij ingetrokken toegang.
const FOTO_OPSLAG = 'mee-op-reis-fotos';
const APP_BESTANDEN = [
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/opslag.js',
  '/js/hulp.js',
  '/js/onderdelen.js',
  '/js/reis.js',
  '/js/beheer.js',
  '/js/vendor/preact-htm.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/fraunces.woff2',
  '/fonts/albert-sans.woff2',
];
// Sfeerbeelden zijn mooi maar niet nodig: mislukt er één, dan moet de app
// nog steeds zonder internet werken. De overige beelden komen in de opslag
// zodra ze voor het eerst getoond worden.
const SFEERBEELDEN = ['/omslag/zee.jpg'];

self.addEventListener('install', (gebeurtenis) => {
  gebeurtenis.waitUntil(
    caches.open(OPSLAG)
      .then(async (opslag) => {
        await opslag.addAll(APP_BESTANDEN.map((pad) => new Request(pad, { cache: 'reload' })));
        await Promise.all(SFEERBEELDEN.map((pad) => opslag.add(pad).catch(() => {})));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (gebeurtenis) => {
  gebeurtenis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== OPSLAG && n !== FOTO_OPSLAG).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function uitOpslagEnVerversen(gebeurtenis, sleutel) {
  const opslag = await caches.open(OPSLAG);
  const bewaard = await opslag.match(sleutel);
  const vers = fetch(sleutel, { cache: 'no-cache' })
    .then((antwoord) => {
      if (antwoord.ok) opslag.put(sleutel, antwoord.clone());
      return antwoord;
    })
    .catch(() => null);
  if (bewaard) {
    gebeurtenis.waitUntil(vers);
    return bewaard;
  }
  return (await vers) || new Response('Geen verbinding.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function fotoUitOpslag(verzoek, pad) {
  const opslag = await caches.open(FOTO_OPSLAG);
  const bewaard = await opslag.match(pad);
  if (bewaard) return bewaard;
  const antwoord = await fetch(verzoek);
  if (antwoord.ok) opslag.put(pad, antwoord.clone());
  return antwoord;
}

self.addEventListener('fetch', (gebeurtenis) => {
  const verzoek = gebeurtenis.request;
  const url = new URL(verzoek.url);
  if (verzoek.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/afbeeldingen/')) {
    gebeurtenis.respondWith(fotoUitOpslag(verzoek, url.pathname));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  // Elke schermadres (bijvoorbeeld /reis/…/programma) wordt door dezelfde app getoond.
  const sleutel = verzoek.mode === 'navigate' ? '/index.html' : url.pathname;
  gebeurtenis.respondWith(uitOpslagEnVerversen(gebeurtenis, sleutel));
});

// Service worker : l'application est mise en cache pour s'ouvrir vite et s'installer sur
// l'écran d'accueil. Le réseau passe en priorité (une partie à plusieurs téléphones a de toute
// façon besoin d'Internet) : tout le monde a ainsi la même version que l'hôte.
const VERSION = 'triplette-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/mqtt.esm.js',
  './engine/rules.js',
  './engine/game.js',
  './state/store.js',
  './state/privacy.js',
  './net/crypto.js',
  './net/room.js',
  './ui/dom.js',
  './ui/art.js',
  './ui/sound.js',
  './ui/texts.js',
  './ui/components.js',
  './ui/screens/home.js',
  './ui/screens/lobby.js',
  './ui/screens/rules.js',
  './ui/screens/table.js',
  './ui/screens/gameOver.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((cache) => cache.put(key, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(key, { ignoreSearch: req.mode === 'navigate' })) || (await caches.match('./index.html')) || Response.error()),
  );
});

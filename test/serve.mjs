// Serveur de développement : sert public/ sous /trio-game/ (comme GitHub Pages)
// et lance un relais MQTT local (WebSocket) pour jouer à plusieurs sans Internet.
// Usage : npm run dev   → ouvre l'adresse affichée, puis d'autres onglets : chacun propose de
// « jouer ici comme un autre joueur ».
// (Sur un téléphone, le chiffrement exige une adresse https : on y joue depuis l'adresse publiée.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 8101;
const BROKER_PORT = Number(process.env.BROKER_PORT) || 8885;
const BASE = '/trio-game/';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/** Relais MQTT local en WebSocket. */
export async function startBroker(port = BROKER_PORT) {
  const aedes = require('aedes');
  const { createServer } = require('aedes-server-factory');
  const broker = await aedes.createBroker();
  const server = createServer(broker, { ws: true });
  await new Promise((r) => server.listen(port, r));
  return {
    broker, server, url: `ws://localhost:${port}`,
    close: () => new Promise((r) => { server.close(() => broker.close(r)); }),
  };
}

export function start(port = PORT) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith(BASE)) { res.writeHead(302, { location: BASE }); return res.end(); }
    let file = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname.slice(BASE.length))));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, url: `http://localhost:${port}${BASE}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await start();
  const relay = await startBroker();
  console.log(`Triplette : ${url}?broker=${relay.url}`);
  console.log('(Relais local. Sans ?broker=…, l’appli utilise le relais public.)');
}

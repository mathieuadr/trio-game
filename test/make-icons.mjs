// Génère les icônes de l'application à partir du dessin SVG de ui/art.js.
// Usage : node test/make-icons.mjs   (Playwright requis)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { appIcon } from '../public/ui/art.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const svg = appIcon();
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);

const browser = await chromium.launch();
const shot = async (file, size, pad = 0) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // `pad` réduit le dessin pour la zone de sécurité des icônes « maskable »
  await page.setContent(`<body style="margin:0;background:#140a2e;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg}</div></body>`);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
};
await shot('icon-192.png', 192);
await shot('icon-512.png', 512);
await shot('icon-maskable-512.png', 512, 46);
await shot('apple-touch-icon.png', 180);
await browser.close();
console.log('Icônes écrites dans public/icons/');

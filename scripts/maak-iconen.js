// Tekent de app-iconen (alleen nodig als het ontwerp verandert).
// Vereist Playwright: npm i -D playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const map = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Een zeil in goud op marineblauw. "schaal" houdt het beeld binnen de veilige
// zone van maskeerbare iconen (Android snijdt de randen af).
const svg = (schaal, rond) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="goud" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b98a35"/><stop offset=".45" stop-color="#dcb05a"/>
      <stop offset=".62" stop-color="#f0d492"/><stop offset="1" stop-color="#cf9d42"/>
    </linearGradient>
    <linearGradient id="nacht" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c2547"/><stop offset="1" stop-color="#04101f"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rond}" fill="url(#nacht)"/>
  <g transform="translate(256 256) scale(${schaal}) translate(-256 -256)">
    <path d="M244 84 C244 190 196 280 108 338 L244 338 Z" fill="url(#goud)"/>
    <path d="M268 150 C300 220 344 290 396 338 L268 338 Z" fill="url(#goud)" opacity=".72"/>
    <path d="M92 366 H420 C402 402 368 424 328 424 H184 C144 424 110 402 92 366 Z" fill="url(#goud)"/>
    <path d="M96 462 q40 -22 80 0 t80 0 t80 0 t80 0" fill="none" stroke="#ecc87e" stroke-width="9" stroke-linecap="round" opacity=".7"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const pagina = await browser.newPage();
for (const [naam, maat, schaal, rond] of [
  ['icon-192.png', 192, 0.86, 96],
  ['icon-512.png', 512, 0.86, 96],
  ['icon-maskable-512.png', 512, 0.68, 0],
  ['apple-touch-icon.png', 180, 0.8, 0],
]) {
  await pagina.setViewportSize({ width: maat, height: maat });
  await pagina.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${maat}px;height:${maat}px}</style>${svg(schaal, rond)}`);
  await pagina.screenshot({ path: path.join(map, naam), omitBackground: true });
  console.log(`Gemaakt: ${naam}`);
}
await browser.close();

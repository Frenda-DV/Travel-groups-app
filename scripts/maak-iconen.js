// Tekent de app-iconen (alleen nodig als het ontwerp verandert).
// Vereist Playwright: npm i -D playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const map = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Een zeilbootje onder een opkomende zon. "schaal" houdt het beeld binnen de
// veilige zone van maskeerbare iconen (Android snijdt de randen af).
const svg = (schaal, rond) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rond}" fill="#0b4f6c"/>
  <g transform="translate(256 256) scale(${schaal}) translate(-256 -256)">
    <circle cx="352" cy="150" r="46" fill="#f2b632"/>
    <path d="M236 96 L236 330 L112 330 Z" fill="#ffffff"/>
    <path d="M262 150 L262 330 L372 330 Z" fill="#dbeaf1"/>
    <path d="M88 356 H424 L384 420 H136 Z" fill="#ffffff"/>
    <path d="M70 452 q31 -24 62 0 t62 0 t62 0 t62 0 t62 0 t62 0" fill="none" stroke="#9cc7da" stroke-width="16" stroke-linecap="round"/>
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

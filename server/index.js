import { serve } from '@hono/node-server';
import { maakPool, controleerAppRol } from './db.js';
import { maakMail } from './mail.js';
import { maakApp } from './app.js';
import { databaseUrls } from './omgeving.js';

try { process.loadEnvFile(); } catch { /* geen .env: dan gelden de omgevingsvariabelen */ }

const { BASIS_URL, PORT = '3000', RESEND_API_KEY, MAIL_AFZENDER, VERTROUW_PROXY } = process.env;
const DATABASE_URL = databaseUrls().app;
if (!DATABASE_URL) {
  console.error('DATABASE_URL ontbreekt. Kopieer .env.example naar .env en vul hem in.');
  process.exit(1);
}

const basisUrl = (BASIS_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const pool = maakPool(DATABASE_URL);
await controleerAppRol(pool);

const mail = maakMail({ resendKey: RESEND_API_KEY, afzender: MAIL_AFZENDER });
if (!mail.actief) console.warn('Let op: geen RESEND_API_KEY. Uitnodigingen en inlogcodes verschijnen alleen in deze log.');

const app = maakApp({ pool, mail, basisUrl, vertrouwProxy: VERTROUW_PROXY === '1' });
serve({ fetch: app.fetch, port: Number(PORT) }, () => console.log(`Mee op Reis draait op ${basisUrl}`));

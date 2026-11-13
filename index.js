// Startpunt op Vercel. Vercel herkent een Hono-app aan een bestand op deze plek
// dat de app als standaard-export aanbiedt, en serveert de map public/ zelf.
// Lokaal en op een gewone server start je de app met `npm start` (server/index.js).
import { Hono } from 'hono';
import { maakPool, controleerAppRol } from './server/db.js';
import { maakMail } from './server/mail.js';
import { maakApp } from './server/app.js';
import { databaseUrls, publiekAdres } from './server/omgeving.js';

const { app: databaseUrl } = databaseUrls();
// Een functie op Vercel bedient weinig aanvragen tegelijk: houd de pool klein.
const pool = databaseUrl ? maakPool(databaseUrl, { max: 3, idleTimeoutMillis: 5000 }) : null;

// De controle op de databaserol moet slagen voordat er iets bij de database
// komt. Mislukt hij, dan geeft elke API-aanvraag een fout en staat de reden in
// de log; de app blijft dus dicht in plaats van onveilig open.
const gereed = pool
  ? controleerAppRol(pool)
  : Promise.reject(new Error('Geen database ingesteld. Koppel een Postgres-database aan het project en zet APP_DB_PASSWORD.'));
gereed.catch((fout) => console.error(fout.message));

const app = maakApp({
  pool,
  mail: maakMail({ resendKey: process.env.RESEND_API_KEY, afzender: process.env.MAIL_AFZENDER }),
  basisUrl: process.env.VERCEL_ENV === 'production' || process.env.BASIS_URL ? publiekAdres() : '',
  vertrouwProxy: true,
  veilig: true,
  gereed,
});

if (!(app instanceof Hono)) throw new Error('maakApp hoort een Hono-app terug te geven.');
export default app;

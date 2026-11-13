// Gedeeld door de beheerscripts. Deze scripts draaien als eigenaar van de
// database en zijn bedoeld voor wie de app beheert, niet voor reisorganisaties.
import pg from 'pg';
import { nieuwToken, hash } from '../server/beveiliging.js';

try { process.loadEnvFile(); } catch { /* geen .env */ }

export async function alsEigenaar(werk) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('Zet DATABASE_ADMIN_URL (eigenaar van de database), bijvoorbeeld in .env.');
    process.exit(1);
  }
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('begin');
    const uitkomst = await werk(db);
    await db.query('commit');
    return uitkomst;
  } catch (fout) {
    await db.query('rollback');
    throw fout;
  } finally {
    await db.end();
  }
}

export const basisUrl = () => (process.env.BASIS_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

// Maakt een lidmaatschap met een eenmalige uitnodigingslink (30 dagen geldig).
export async function nodigUit(db, { orgId, reisId = null, rol, naam, email }) {
  const token = nieuwToken();
  await db.query(
    `insert into lidmaatschappen (org_id, reis_id, rol, email, naam, uitnodiging_hash, uitnodiging_verloopt_op)
     values ($1, $2, $3, $4, $5, $6, now() + interval '30 days')`,
    [orgId, reisId, rol, email.trim().toLowerCase(), naam, hash(token)]);
  return `${basisUrl()}/u/${token}`;
}

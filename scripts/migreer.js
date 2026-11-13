// Voert de SQL-bestanden in /sql één keer uit, als eigenaar van de database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseUrls } from '../server/omgeving.js';

const sqlMap = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

export async function migreer(adminUrl, { appWachtwoord, stil = false } = {}) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Mee op Reis hoort in een eigen database. Staan er al tabellen van iets
    // anders, dan wordt er niets aangeraakt: de inrichting past rechten op het
    // hele schema aan en de app weigert te draaien naast onafgeschermde tabellen.
    const { rows: bestaand } = await client.query(`
      select to_regclass('public.schema_migraties') is not null as ingericht,
             (select coalesce(string_agg(tablename, ', ' order by tablename), '') from pg_tables where schemaname = 'public') as tabellen`);
    if (!bestaand[0].ingericht && bestaand[0].tabellen) {
      throw new Error(`Deze database is niet leeg (tabellen: ${bestaand[0].tabellen}). Gebruik voor Mee op Reis een eigen, lege database.`);
    }
    await client.query(`create table if not exists schema_migraties (
      bestand text primary key, uitgevoerd_op timestamptz not null default now())`);
    const klaar = new Set((await client.query('select bestand from schema_migraties')).rows.map((r) => r.bestand));
    for (const bestand of fs.readdirSync(sqlMap).filter((f) => f.endsWith('.sql')).sort()) {
      if (klaar.has(bestand)) continue;
      const sql = fs.readFileSync(path.join(sqlMap, bestand), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migraties (bestand) values ($1)', [bestand]);
        await client.query('commit');
        if (!stil) console.log(`Uitgevoerd: ${bestand}`);
      } catch (fout) {
        await client.query('rollback');
        throw fout;
      }
    }
    if (appWachtwoord) {
      // ALTER ROLE accepteert geen parameters; quote_literal voorkomt injectie.
      const { rows } = await client.query('select quote_literal($1) as w', [appWachtwoord]);
      await client.query(`alter role reisapp_app login password ${rows[0].w}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(); } catch { /* geen .env: dan gelden de omgevingsvariabelen */ }
  const url = databaseUrls().admin;
  if (!url) {
    console.error('Zet DATABASE_ADMIN_URL (eigenaar van de database).');
    process.exit(1);
  }
  await migreer(url, { appWachtwoord: process.env.APP_DB_PASSWORD });
  console.log('Database is bijgewerkt.');
}

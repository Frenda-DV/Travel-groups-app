// Draait bij elke build op Vercel.
//   1. Werkt de database bij (alleen nieuwe SQL-bestanden worden uitgevoerd).
//   2. Richt de app in als daar om gevraagd is, en alleen als het nog niet is gebeurd:
//        DEMO_BEHEERDER=adres@voorbeeld.nl
//          zet de Jubileumcruise klaar met drie eenmalige links
//        EERSTE_ORGANISATIE="Naam organisatie|Naam beheerder|adres@voorbeeld.nl"
//          maakt een organisatie met een eerste beheerder
//      De links verschijnen in de build-log van Vercel en werken één keer.
import pg from 'pg';
import { migreer } from './migreer.js';
import { alsEigenaar, nodigUit } from './hulp.js';
import { vulDemo, toonLinks, DEMO_ORGANISATIE } from './demo-vullen.js';
import { databaseUrls } from '../server/omgeving.js';

const { admin } = databaseUrls();
const { APP_DB_PASSWORD, DEMO_BEHEERDER, EERSTE_ORGANISATIE } = process.env;

if (!admin) {
  console.error('Geen database gevonden. Koppel in Vercel een Postgres-database (Storage, bijvoorbeeld Neon) aan dit project en bouw opnieuw.');
  process.exit(1);
}
if (!APP_DB_PASSWORD || APP_DB_PASSWORD.length < 20) {
  console.error('Zet de omgevingsvariabele APP_DB_PASSWORD (minstens 20 tekens). Dit wordt het wachtwoord van de beperkte databaserol waarmee de app draait.');
  process.exit(1);
}

// EENMALIG HERSTEL (13 november 2026). De eerste build is per ongeluk uitgevoerd
// in een bestaande database met tabellen van andere toepassingen. Dit blok
// herkent precies die database, verwijdert daar alles wat Mee op Reis heeft
// aangemaakt en zet de rechten op het schema terug naar de standaard. Andere
// tabellen worden niet aangeraakt. Daarna stopt de build op de controle
// hieronder, tot er een eigen, lege database is gekoppeld. Dit blok kan weg
// zodra de app op zijn eigen database draait.
{
  const db = new pg.Client({ connectionString: admin });
  await db.connect();
  try {
    const { rows } = await db.query(`
      select to_regclass('public.schema_migraties') is not null as ingericht,
        (select count(*)::int from pg_tables where schemaname = 'public'
          and tablename in ('players', 'seasons', 'dossiers', 'opening_balances', 'sender_rules')) as vreemd`);
    if (rows[0].ingericht && rows[0].vreemd === 5) {
      console.log('Gedeelde database herkend: Mee op Reis wordt hier verwijderd en de rechten worden hersteld.');
      await db.query(`
        begin;
        drop table if exists
          berichten, info_blokken, programma_onderdelen, programma_dagen,
          sessie_toegang, sessies, login_tokens, lidmaatschappen, reizen, organisaties,
          schema_migraties
          cascade;
        drop function if exists
          zet_bijgewerkt_op(), mijn_leden(), is_beheerder(uuid), is_lid_van_org(uuid), reis_rol(uuid),
          reis_is_open(uuid), mag_reis_lezen(uuid, uuid), mag_reis_beheren(uuid, uuid),
          mag_lid_beheren(uuid, uuid, text), mijn_naam(uuid, uuid), reis_groepsleiders(uuid),
          auth_sessie(text), auth_uitnodiging_bekijken(text), auth_sessie_kiezen(text, text, timestamptz),
          auth_uitnodiging_accepteren(text, text, text, timestamptz),
          auth_login_aanvragen(text, text, text, timestamptz),
          auth_login_voltooien(text, text, text, text, text, timestamptz),
          auth_uitloggen(text), lid_intrekken(uuid), lid_nieuwe_link(uuid, text, timestamptz)
          cascade;
        revoke all on all functions in schema public from reisapp_app;
        revoke all on schema public from reisapp_app;
        grant usage on schema public to public;
        grant execute on all functions in schema public to public;
        commit;`);
      await db.query('drop role if exists reisapp_app').catch((fout) => console.log(`Rol reisapp_app blijft bestaan: ${fout.message}`));
      const { rows: over } = await db.query(`select string_agg(tablename, ', ' order by tablename) as t from pg_tables where schemaname = 'public'`);
      console.log(`Opgeruimd. Tabellen die er nu staan (allemaal van andere toepassingen): ${over[0].t}`);
    }
  } finally {
    await db.end();
  }
}

await migreer(admin, { appWachtwoord: APP_DB_PASSWORD });
console.log('Database is bijgewerkt.');

const bestaat = (db, naam) => db.query('select 1 from organisaties where naam = $1', [naam]).then((r) => r.rowCount > 0);

if (DEMO_BEHEERDER) {
  const links = await alsEigenaar(async (db) => ((await bestaat(db, DEMO_ORGANISATIE)) ? null : vulDemo(db, DEMO_BEHEERDER)));
  if (links) toonLinks(links, DEMO_BEHEERDER);
  else console.log(`${DEMO_ORGANISATIE} bestaat al; de demo is niet opnieuw gevuld.`);
}

if (EERSTE_ORGANISATIE) {
  const [naam, beheerder, email] = EERSTE_ORGANISATIE.split('|').map((s) => s.trim());
  if (!naam || !beheerder || !email) {
    console.error('EERSTE_ORGANISATIE moet de vorm "Naam organisatie|Naam beheerder|adres@voorbeeld.nl" hebben.');
    process.exit(1);
  }
  const link = await alsEigenaar(async (db) => {
    if (await bestaat(db, naam)) return null;
    const { rows } = await db.query('insert into organisaties (naam) values ($1) returning id', [naam]);
    return nodigUit(db, { orgId: rows[0].id, rol: 'beheerder', naam: beheerder, email });
  });
  console.log(link ? `Organisatie "${naam}" is aangemaakt. Eenmalige link voor ${beheerder}:\n${link}` : `Organisatie "${naam}" bestaat al.`);
}

// Draait bij elke build op Vercel.
//   1. Werkt de database bij (alleen nieuwe SQL-bestanden worden uitgevoerd).
//   2. Richt de app in als daar om gevraagd is, en alleen als het nog niet is gebeurd:
//        DEMO_BEHEERDER=adres@voorbeeld.nl
//          zet de Jubileumcruise klaar met drie eenmalige links
//        EERSTE_ORGANISATIE="Naam organisatie|Naam beheerder|adres@voorbeeld.nl"
//          maakt een organisatie met een eerste beheerder
//      De links verschijnen in de build-log van Vercel en werken één keer.
import fs from 'node:fs';
import { migreer } from './migreer.js';
import { alsEigenaar, nodigUit, basisUrl } from './hulp.js';
import { nieuwToken, hash } from '../server/beveiliging.js';
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

// Proeftuin: een aparte organisatie met alleen fictieve gegevens, om de
// live-omgeving na elke wijziging door te testen. Elke build maakt een verse,
// eenmalige beheerderslink (één dag geldig) en trekt de vorige toegang in.
if (fs.existsSync('rooktest.json')) {
  const proef = JSON.parse(fs.readFileSync('rooktest.json', 'utf8'));
  const link = await alsEigenaar(async (db) => {
    let org = (await db.query('select id from organisaties where naam = $1', [proef.organisatie])).rows[0]?.id;
    org ??= (await db.query('insert into organisaties (naam) values ($1) returning id', [proef.organisatie])).rows[0].id;
    const lid = (await db.query('select id from lidmaatschappen where org_id = $1 and reis_id is null and email = $2', [org, proef.email])).rows[0];
    if (!lid) return nodigUit(db, { orgId: org, rol: 'beheerder', naam: proef.beheerder, email: proef.email });
    return verseLink(db, lid.id, 1);
  });
  console.log(`ROOKTEST ${link}`);
}

// Nieuwe beheerderslink op verzoek, voor als inloggen per e-mail (nog) niet
// werkt. Zet een leeg bestand "nieuwe-beheerderslink" in de repository: de
// eerstvolgende build maakt dan een verse, eenmalige link (7 dagen geldig) voor
// de beheerder uit DEMO_BEHEERDER en zet hem in de build-log. Haal het bestand
// daarna weer weg, anders vervalt de toegang bij elke build opnieuw.
if (fs.existsSync('nieuwe-beheerderslink') && DEMO_BEHEERDER) {
  const link = await alsEigenaar(async (db) => {
    const lid = (await db.query(
      `select l.id from lidmaatschappen l join organisaties o on o.id = l.org_id
       where o.naam = $1 and l.reis_id is null and l.rol = 'beheerder' and l.email = $2`,
      [DEMO_ORGANISATIE, DEMO_BEHEERDER.trim().toLowerCase()])).rows[0];
    return lid ? verseLink(db, lid.id, 7) : null;
  });
  console.log(link ? `BEHEERDERSLINK ${link}` : `Geen beheerder gevonden voor ${DEMO_ORGANISATIE}.`);
}

// Geeft een bestaand lidmaatschap een verse, eenmalige link. Bestaande toegang vervalt.
async function verseLink(db, lidId, dagen) {
  const token = nieuwToken();
  await db.query(
    `update lidmaatschappen set uitnodiging_hash = $2, uitnodiging_verloopt_op = now() + make_interval(days => $3),
       uitnodiging_gebruikt_op = null, ingetrokken_op = null where id = $1`, [lidId, hash(token), dagen]);
  await db.query('delete from sessie_toegang where lidmaatschap_id = $1', [lidId]);
  return `${basisUrl()}/u/${token}`;
}

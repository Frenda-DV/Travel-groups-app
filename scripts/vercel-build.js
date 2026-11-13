// Draait bij elke build op Vercel.
//   1. Werkt de database bij (alleen nieuwe SQL-bestanden worden uitgevoerd).
//   2. Richt de app in als daar om gevraagd is, en alleen als het nog niet is gebeurd:
//        DEMO_BEHEERDER=adres@voorbeeld.nl
//          zet de Jubileumcruise klaar met drie eenmalige links
//        EERSTE_ORGANISATIE="Naam organisatie|Naam beheerder|adres@voorbeeld.nl"
//          maakt een organisatie met een eerste beheerder
//      De links verschijnen in de build-log van Vercel en werken één keer.
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

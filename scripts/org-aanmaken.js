// Nieuwe reisorganisatie met een eerste beheerder.
//   npm run org:nieuw -- "Naam organisatie" "Naam beheerder" beheerder@voorbeeld.nl
import { alsEigenaar, nodigUit } from './hulp.js';

const [orgNaam, beheerder, email] = process.argv.slice(2);
if (!orgNaam || !beheerder || !email) {
  console.error('Gebruik: npm run org:nieuw -- "Naam organisatie" "Naam beheerder" beheerder@voorbeeld.nl');
  process.exit(1);
}

const link = await alsEigenaar(async (db) => {
  const { rows } = await db.query('insert into organisaties (naam) values ($1) returning id', [orgNaam]);
  return nodigUit(db, { orgId: rows[0].id, rol: 'beheerder', naam: beheerder, email });
});
console.log(`Organisatie "${orgNaam}" is aangemaakt.\nStuur ${beheerder} deze eenmalige link (30 dagen geldig):\n${link}`);

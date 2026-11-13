// Gedeelde testopzet: een verse database met twee fictieve reisorganisaties.
//
// Alle testgegevens zijn FICTIEF. Elke rij draagt een merkteken van de reis
// waar hij bij hoort (#A1#, #A2#, #B1#, #B2#) of van de organisatie (#A#, #B#).
// Zo kan een test elk antwoord van de server doorzoeken: staat er een merkteken
// in dat niet bij de ingelogde persoon hoort, dan is er gelekt.
import crypto from 'node:crypto';
import pg from 'pg';
import { serve } from '@hono/node-server';
import { migreer } from '../scripts/migreer.js';
import { maakPool, controleerAppRol } from '../server/db.js';
import { maakMail } from '../server/mail.js';
import { maakApp } from '../server/app.js';

pg.types.setTypeParser(1082, (w) => w);

const hash = (w) => crypto.createHash('sha256').update(w).digest('hex');
const APP_WACHTWOORD = process.env.APP_DB_PASSWORD || 'app_dev';

export function databaseUrls(naam) {
  const admin = process.env.TEST_DATABASE_ADMIN_URL || `postgres://reisapp_owner:owner_dev@localhost:5432/${naam}`;
  const app = new URL(admin);
  app.username = 'reisapp_app';
  app.password = APP_WACHTWOORD;
  return { admin, app: app.toString() };
}

export async function verseDatabase(naam = 'reisapp_test') {
  const urls = databaseUrls(naam);
  const client = new pg.Client({ connectionString: urls.admin });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  await migreer(urls.admin, { appWachtwoord: APP_WACHTWOORD, stil: true });
  const admin = new pg.Pool({ connectionString: urls.admin, max: 4 });
  const app = maakPool(urls.app);
  await controleerAppRol(app);
  return { admin, app };
}

export const REIZEN = ['A1', 'A2', 'B1', 'B2'];
export const orgVan = (reis) => reis[0];

// Wie mag wat. Dit is dezelfde matrix als in docs/toegangsmatrix.md.
//   lezen:   reizen waarvan deze persoon programma, info en berichten ziet
//   beheren: reizen waarvan deze persoon programma, info, berichten en deelnemers beheert
//   beheerder: organisaties waar deze persoon reizen aanmaakt en groepsleiders aanwijst
export const PERSONAS = {
  beheerderA: { lezen: ['A1', 'A2'], beheren: ['A1', 'A2'], beheerder: ['A'] },
  leiderA1:   { lezen: ['A1'], beheren: ['A1'], beheerder: [] },
  leiderA2:   { lezen: ['A2'], beheren: ['A2'], beheerder: [] },
  anna:       { lezen: ['A1'], beheren: [], beheerder: [] },
  bram:       { lezen: ['A1'], beheren: [], beheerder: [] },
  cor:        { lezen: ['A2'], beheren: [], beheerder: [] },
  dirk:       { lezen: [], beheren: [], beheerder: [] }, // toegang ingetrokken
  beheerderB: { lezen: ['B1', 'B2'], beheren: ['B1', 'B2'], beheerder: ['B'] },
  leiderB1:   { lezen: ['B1'], beheren: ['B1'], beheerder: [] },
  eva:        { lezen: ['B1'], beheren: [], beheerder: [] },
  fien:       { lezen: ['B2'], beheren: [], beheerder: [] },
  gerda:      { lezen: ['A1', 'B1'], beheren: [], beheerder: [] }, // reist met beide organisaties
  henk:       { lezen: [], beheren: [], beheerder: [] }, // sessie verlopen
  nep:        { lezen: [], beheren: [], beheerder: [] }, // verzonnen cookie
  anoniem:    { lezen: [], beheren: [], beheerder: [] }, // geen cookie
};

export async function zaai(admin) {
  const q = (sql, p) => admin.query(sql, p).then((r) => r.rows);
  const ids = { org: {}, reis: {}, lid: {}, dag: {}, onderdeel: {}, info: {}, bericht: {} };
  const tokens = {};

  const orgNamen = { A: 'Zonnevaart Reizen #A#', B: 'Noorderlicht Tours #B#' };
  for (const [k, naam] of Object.entries(orgNamen)) {
    ids.org[k] = (await q('insert into organisaties (naam) values ($1) returning id', [naam]))[0].id;
  }
  const reisTitels = { A1: 'Rijncruise Keulen', A2: 'Douro Portugal', B1: 'Noorse kust', B2: 'IJsland rondreis' };
  for (const r of REIZEN) {
    ids.reis[r] = (await q(
      `insert into reizen (org_id, titel, ondertitel, start_datum, eind_datum)
       values ($1, $2, $3, '2027-05-10', '2027-05-12') returning id`,
      [ids.org[orgVan(r)], `${reisTitels[r]} #${r}#`, `Fictieve testreis #${r}#`]))[0].id;
    for (const [i, datum] of ['2027-05-10', '2027-05-11'].entries()) {
      const dag = (await q(
        `insert into programma_dagen (org_id, reis_id, datum, titel, ondertitel, toelichting)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [ids.org[orgVan(r)], ids.reis[r], datum, `Dag ${i + 1} #${r}#`, `In de haven van 08:00 tot 17:00 #${r}#`, `Toelichting #${r}#`]))[0].id;
      ids.dag[`${r}.${i + 1}`] = dag;
      const onderdelen = [
        ['09:15', '12:30', `Stadswandeling #${r}#`, '09:00', `Bij de loopplank, gids met rode paraplu #${r}#`, false],
        ['14:00', null, `Excursie museum #${r}#`, '13:45', `Receptie dek 3 #${r}#`, true],
      ];
      for (const [j, o] of onderdelen.entries()) {
        ids.onderdeel[`${r}.${i + 1}.${j + 1}`] = (await q(
          `insert into programma_onderdelen (org_id, reis_id, dag_id, begin_tijd, eind_tijd, titel, verzameltijd, verzamelpunt, omschrijving, meenemen, facultatief)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
          [ids.org[orgVan(r)], ids.reis[r], dag, o[0], o[1], o[2], o[3], o[4], `Omschrijving #${r}#`, `Regenjas #${r}#`, o[5]]))[0].id;
      }
    }
    ids.info[r] = (await q(
      `insert into info_blokken (org_id, reis_id, titel, tekst) values ($1, $2, $3, $4) returning id`,
      [ids.org[orgVan(r)], ids.reis[r], `Noodnummer #${r}#`, `Bel de reisleiding op 06 00000000 #${r}#`]))[0].id;
    for (const [i, belangrijk] of [false, true].entries()) {
      ids.bericht[`${r}.${i + 1}`] = (await q(
        `insert into berichten (org_id, reis_id, tekst, belangrijk, auteur_naam) values ($1, $2, $3, $4, $5) returning id`,
        [ids.org[orgVan(r)], ids.reis[r], `Bericht ${i + 1} #${r}#`, belangrijk, `Leider #${r}#`]))[0].id;
    }
  }

  async function lid(sleutel, org, reis, rol, naam, email, extra = {}) {
    ids.lid[sleutel] = (await q(
      `insert into lidmaatschappen (org_id, reis_id, rol, email, naam, geaccepteerd_op, ingetrokken_op)
       values ($1, $2, $3, $4, $5, now(), $6) returning id`,
      [ids.org[org], reis ? ids.reis[reis] : null, rol, email, naam, extra.ingetrokken ? new Date() : null]))[0].id;
    return ids.lid[sleutel];
  }
  async function sessie(persona, lidIds, { verlopen = false } = {}) {
    const token = `test-${persona}-${crypto.randomBytes(12).toString('hex')}`;
    await q('insert into sessies (token_hash, verloopt_op) values ($1, $2)',
      [hash(token), new Date(Date.now() + (verlopen ? -1 : 1) * 86400000)]);
    for (const id of lidIds) await q('insert into sessie_toegang (sessie_hash, lidmaatschap_id) values ($1, $2)', [hash(token), id]);
    tokens[persona] = token;
  }

  await sessie('beheerderA', [await lid('beheerderA', 'A', null, 'beheerder', 'Beheerder Zonnevaart #A#', 'beheer@a.test')]);
  await sessie('leiderA1', [await lid('leiderA1', 'A', 'A1', 'groepsleider', 'Leider Lotte #A1#', 'lotte@a1.test')]);
  await sessie('leiderA2', [await lid('leiderA2', 'A', 'A2', 'groepsleider', 'Leider Lars #A2#', 'lars@a2.test')]);
  await sessie('anna', [await lid('anna', 'A', 'A1', 'deelnemer', 'Anna #A1#', 'anna@a1.test')]);
  await sessie('bram', [await lid('bram', 'A', 'A1', 'deelnemer', 'Bram #A1#', 'bram@a1.test')]);
  await sessie('cor', [await lid('cor', 'A', 'A2', 'deelnemer', 'Cor #A2#', 'cor@a2.test')]);
  // Dirk: de koppeling met zijn sessie bestaat nog, maar zijn toegang is ingetrokken.
  await sessie('dirk', [await lid('dirk', 'A', 'A1', 'deelnemer', 'Dirk #A1#', 'dirk@a1.test', { ingetrokken: true })]);
  await sessie('beheerderB', [await lid('beheerderB', 'B', null, 'beheerder', 'Beheerder Noorderlicht #B#', 'beheer@b.test')]);
  await sessie('leiderB1', [await lid('leiderB1', 'B', 'B1', 'groepsleider', 'Leider Bente #B1#', 'bente@b1.test')]);
  await sessie('eva', [await lid('eva', 'B', 'B1', 'deelnemer', 'Eva #B1#', 'eva@b1.test')]);
  await sessie('fien', [await lid('fien', 'B', 'B2', 'deelnemer', 'Fien #B2#', 'fien@b2.test')]);
  await sessie('gerda', [
    await lid('gerdaA1', 'A', 'A1', 'deelnemer', 'Gerda #A1#', 'gerda@dubbel.test'),
    await lid('gerdaB1', 'B', 'B1', 'deelnemer', 'Gerda #B1#', 'gerda@dubbel.test'),
  ]);
  await sessie('henk', [await lid('henk', 'A', 'A1', 'deelnemer', 'Henk #A1#', 'henk@a1.test')], { verlopen: true });
  tokens.nep = `test-nep-${crypto.randomBytes(12).toString('hex')}`;
  tokens.anoniem = null;

  return { ids, tokens, hash };
}

// Merktekens die deze persoon mag tegenkomen: de eigen reizen en hun organisaties.
export function toegestaneMerken(persona) {
  const p = PERSONAS[persona];
  return new Set([...p.lezen, ...p.lezen.map(orgVan), ...p.beheerder]);
}
export function vreemdeMerken(tekst, persona) {
  const mag = toegestaneMerken(persona);
  const gevonden = new Set();
  for (const m of String(tekst).matchAll(/#(A1|A2|B1|B2|A|B)#/g)) if (!mag.has(m[1])) gevonden.add(m[1]);
  for (const m of String(tekst).matchAll(/@(a1|a2|b1|b2|a|b)\.test/g)) if (!mag.has(m[1].toUpperCase())) gevonden.add(m[1].toUpperCase());
  return [...gevonden];
}

async function vrijePoort() {
  const net = await import('node:net');
  return new Promise((klaar) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => klaar(port));
    });
  });
}

export async function startServer(pool) {
  const mail = maakMail({ stil: true });
  const poort = await vrijePoort();
  const url = `http://localhost:${poort}`;
  const app = maakApp({ pool, mail, basisUrl: url });
  const server = await new Promise((klaar) => {
    const s = serve({ fetch: app.fetch, port: poort }, () => klaar(s));
  });
  return { url, mail, sluit: () => new Promise((k) => { server.closeAllConnections?.(); server.close(k); }) };
}

export function maakVrager(url, tokens) {
  return async function vraag(persona, methode, pad, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = typeof persona === 'string' ? tokens[persona] : persona?.cookie;
    if (token) headers.cookie = `sessie=${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const antwoord = await fetch(url + pad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const tekst = await antwoord.text();
    let json = null;
    try { json = JSON.parse(tekst); } catch { /* geen JSON */ }
    const cookie = (antwoord.headers.get('set-cookie') || '').match(/sessie=([^;]+)/)?.[1] || null;
    return { status: antwoord.status, tekst, json, cookie };
  };
}

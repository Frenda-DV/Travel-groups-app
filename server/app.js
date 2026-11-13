import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { nieuwToken, hash, nieuweCode, codeHash, maakLimiet } from './beveiliging.js';
import { uitnodigingsMail, inlogMail } from './mail.js';
import { metHerkansing } from './db.js';

const publiekeMap = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSIE_DAGEN = 180;
const KWARTIER = 15 * 60 * 1000;
const OMSLAGEN = ['zee', 'fjorden', 'rivier', 'stad', 'landschap'];

class Fout extends Error {
  constructor(status, melding) {
    super(melding);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Invoercontrole
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(waarde) {
  if (typeof waarde !== 'string' || !UUID.test(waarde)) throw new Fout(404, 'Niet gevonden.');
  return waarde;
}
function tekst(waarde, veld, { max, verplicht = false }) {
  if (waarde == null) waarde = '';
  if (typeof waarde !== 'string') throw new Fout(400, `${veld} is ongeldig.`);
  waarde = waarde.trim();
  if (verplicht && !waarde) throw new Fout(400, `${veld} is verplicht.`);
  if (waarde.length > max) throw new Fout(400, `${veld} is te lang (maximaal ${max} tekens).`);
  return waarde;
}
function tijd(waarde, veld) {
  if (waarde == null || waarde === '') return null;
  if (typeof waarde !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(waarde)) throw new Fout(400, `${veld} is geen geldige tijd.`);
  return waarde;
}
function datum(waarde, veld) {
  if (typeof waarde !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(waarde) || Number.isNaN(Date.parse(`${waarde}T00:00:00Z`))) {
    throw new Fout(400, `${veld} is geen geldige datum.`);
  }
  return waarde;
}
function emailadres(waarde) {
  if (typeof waarde !== 'string') throw new Fout(400, 'Vul een e-mailadres in.');
  waarde = waarde.trim().toLowerCase();
  if (waarde.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(waarde)) throw new Fout(400, `"${waarde.slice(0, 60)}" is geen geldig e-mailadres.`);
  return waarde;
}
const bool = (waarde) => waarde === true;
const fotoId = (waarde) => {
  if (waarde == null || waarde === '') return null;
  if (typeof waarde !== 'string' || !UUID.test(waarde)) throw new Fout(400, 'Ongeldige foto.');
  return waarde;
};

// Herkent een foto aan de eerste bytes; op de opgegeven bestandssoort wordt niet vertrouwd.
function fotoSoort(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const MAX_FOTO = 650_000;

async function invoer(c) {
  if (!(c.req.header('content-type') || '').startsWith('application/json')) throw new Fout(415, 'Verwacht JSON.');
  try {
    const data = await c.req.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new Fout(400, 'Ongeldige invoer.');
  }
}

// ---------------------------------------------------------------------------

// basisUrl: publiek adres voor links in mails. Leeg laten mag: dan geldt het
//   adres waarop de aanvraag binnenkwam.
// gereed: een functie die een belofte geeft; die moet slagen (de controle op
//   de databaserol) voordat er ook maar één aanvraag bij de database komt.
// enigeHost: als dit is ingevuld, wordt elk bezoek via een ander adres
//   doorgestuurd. Op Vercel heeft elke build een eigen, vast adres dat altijd
//   die oude versie blijft tonen; daar mag niemand per ongeluk blijven hangen.
export function maakApp({ pool, mail, basisUrl = '', vertrouwProxy = false, veilig = basisUrl.startsWith('https://'), gereed = null, enigeHost = '' }) {
  const app = new Hono();

  if (enigeHost) {
    app.use('*', async (c, next) => {
      const host = c.req.header('host');
      const url = new URL(c.req.url);
      if (host && host !== enigeHost && c.req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        return c.redirect(`https://${enigeHost}${url.pathname}${url.search}`, 307);
      }
      await next();
    });
  }
  const adresVan = (c) => basisUrl || new URL(c.req.url).origin;
  const COOKIE = veilig ? '__Host-sessie' : 'sessie';
  const teVaak = maakLimiet();

  const ipVan = (c) =>
    (vertrouwProxy && (c.req.header('x-forwarded-for') || '').split(',')[0].trim()) ||
    c.env?.incoming?.socket?.remoteAddress || 'onbekend';

  function zetSessieCookie(c, token) {
    setCookie(c, COOKIE, token, {
      httpOnly: true, secure: veilig, sameSite: 'Lax', path: '/', maxAge: SESSIE_DAGEN * 86400,
    });
  }
  const sessieVerloopt = () => new Date(Date.now() + SESSIE_DAGEN * 86400 * 1000);

  app.onError((fout, c) => {
    if (fout instanceof Fout) return c.json({ fout: fout.message }, fout.status);
    const pg = {
      42501: [403, 'Geen toegang.'],
      23505: [409, 'Dit bestaat al.'],
      23503: [404, 'Niet gevonden.'],
      23514: [400, 'Ongeldige invoer.'],
      '22P02': [404, 'Niet gevonden.'],
      22007: [400, 'Ongeldige datum of tijd.'],
      22008: [400, 'Ongeldige datum of tijd.'],
    }[fout.code];
    if (pg) return c.json({ fout: pg[1] }, pg[0]);
    console.error(fout);
    return c.json({ fout: 'Er ging iets mis. Probeer het opnieuw.' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer'); // uitnodigingslinks mogen niet uitlekken
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (veilig) c.header('Strict-Transport-Security', 'max-age=31536000');
  });

  // Statuscontrole voor beheer: werkt de app en kan hij bij de database?
  // Bij een fout komt alleen een korte code naar buiten; de details staan in de serverlog.
  app.get('/api/gezondheid', async (c) => {
    try {
      if (gereed) await gereed();
      await metHerkansing(() => pool.query('select 1'));
      return c.json({
        ok: true,
        database: 'ok',
        mail: mail.actief ? `ingesteld; laatste verzending: ${mail.stand?.laatste ?? 'onbekend'}` : 'niet ingesteld',
      });
    } catch (fout) {
      console.error('Database niet bereikbaar:', fout);
      const code = fout.code || (/Geen database/.test(fout.message) ? 'niet-ingesteld' : 'onbekend');
      return c.json({ ok: false, database: `fout: ${code}${fout.kort ? ` (${fout.kort})` : ''}` }, 503);
    }
  });

  // Elke API-aanvraag draait in één transactie. De sessie wordt in de database
  // gezet; vanaf dat punt bepaalt row-level security wat zichtbaar is.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET') {
      const herkomst = c.req.header('origin');
      if (herkomst && new URL(herkomst).host !== c.req.header('host')) {
        return c.json({ fout: 'Aanvraag vanaf een andere website geweigerd.' }, 403);
      }
    }
    if (gereed) await gereed();
    const db = await metHerkansing(() => pool.connect());
    try {
      await db.query('begin');
      const token = getCookie(c, COOKIE);
      let sessie = null;
      if (token) {
        const h = hash(token);
        const { rows } = await db.query('select auth_sessie($1) as id', [h]);
        if (rows[0].id) {
          sessie = { id: rows[0].id, hash: h };
          await db.query("select set_config('app.sessie', $1, true)", [h]);
        }
      }
      c.set('db', db);
      c.set('sessie', sessie);
      await next();
      await db.query(c.error ? 'rollback' : 'commit');
    } catch (fout) {
      await db.query('rollback').catch(() => {});
      throw fout;
    } finally {
      db.release();
    }
  });

  const metSessie = async (c, next) => {
    if (!c.get('sessie')) throw new Fout(401, 'Je bent niet ingelogd.');
    await next();
  };

  // ---- Hulpfuncties voor rechten -----------------------------------------

  async function haalReis(db, reisId) {
    const { rows } = await db.query(
      `select r.id, r.org_id, r.titel, r.ondertitel, r.start_datum, r.eind_datum, r.gearchiveerd, r.omslag, r.omslag_afbeelding_id,
              o.naam as organisatie, reis_rol(r.id) as rol, is_beheerder(r.org_id) as beheerder,
              mag_reis_beheren(r.id, r.org_id) as mag_beheren
       from reizen r join organisaties o on o.id = r.org_id
       where r.id = $1`, [uuid(reisId)]);
    if (!rows[0]) throw new Fout(404, 'Deze reis bestaat niet of je hebt er geen toegang toe.');
    return rows[0];
  }
  async function haalReisVoorBeheer(db, reisId) {
    const reis = await haalReis(db, reisId);
    if (!reis.mag_beheren) throw new Fout(403, 'Alleen de groepsleider kan dit wijzigen.');
    return reis;
  }
  const TABELLEN = { dagen: 'programma_dagen', onderdelen: 'programma_onderdelen', info: 'info_blokken', berichten: 'berichten', afbeeldingen: 'afbeeldingen' };
  const MET_FOTO = new Set(['dagen', 'onderdelen', 'berichten']);
  async function eisBeheerVan(db, soort, id) {
    const { rows } = await db.query(
      `select reis_id, org_id, ${MET_FOTO.has(soort) ? 'afbeelding_id' : 'null as afbeelding_id'},
              mag_reis_beheren(reis_id, org_id) as mag from ${TABELLEN[soort]} where id = $1`, [uuid(id)]);
    if (!rows[0]) throw new Fout(404, 'Niet gevonden.');
    if (!rows[0].mag) throw new Fout(403, 'Alleen de groepsleider kan dit wijzigen.');
    return rows[0];
  }

  // Een foto die nergens meer bij hoort wordt direct verwijderd.
  async function ruimFotoOp(db, oud, nieuw) {
    if (oud && oud !== nieuw) await db.query('delete from afbeeldingen where id = $1', [oud]);
  }

  // ---- Inloggen en uitnodigingen ------------------------------------------

  app.get('/api/uitnodigingen/:token', async (c) => {
    const { rows } = await c.get('db').query('select * from auth_uitnodiging_bekijken($1)', [hash(c.req.param('token'))]);
    if (!rows[0]) throw new Fout(404, 'Deze uitnodigingslink is niet (meer) geldig.');
    return c.json(rows[0]);
  });

  app.post('/api/uitnodigingen/:token/accepteren', async (c) => {
    if (teVaak(`acc:${ipVan(c)}`, 30, KWARTIER)) throw new Fout(429, 'Te veel pogingen. Probeer het over een kwartier opnieuw.');
    const nieuw = nieuwToken();
    const { rows } = await c.get('db').query(
      'select * from auth_uitnodiging_accepteren($1, $2, $3, $4)',
      [hash(c.req.param('token')), c.get('sessie')?.hash ?? null, hash(nieuw), sessieVerloopt()]);
    if (!rows[0]) throw new Fout(410, 'Deze uitnodigingslink is al gebruikt of niet meer geldig.');
    if (rows[0].uitkomst === 'nieuw') zetSessieCookie(c, nieuw);
    return c.json({ ok: true, reis_id: rows[0].reis_id });
  });

  app.post('/api/inloggen/aanvragen', async (c) => {
    const email = emailadres((await invoer(c)).email);
    if (teVaak(`aanvraag:${ipVan(c)}`, 10, KWARTIER) || teVaak(`aanvraag:${email}`, 3, KWARTIER)) {
      throw new Fout(429, 'Te veel aanvragen. Probeer het over een kwartier opnieuw.');
    }
    const token = nieuwToken();
    const code = nieuweCode();
    const { rows } = await c.get('db').query(
      'select auth_login_aanvragen($1, $2, $3, $4) as bekend',
      [email, hash(token), codeHash(email, code), new Date(Date.now() + KWARTIER)]);
    if (rows[0].bekend) {
      await mail.stuur({ aan: email, ...inlogMail({ code, link: `${adresVan(c)}/l/${token}` }) });
    }
    // Altijd hetzelfde antwoord: zo is niet te achterhalen wie deelnemer is.
    return c.json({ ok: true });
  });

  async function voltooiLogin(c, email, codeH, tokenH) {
    if (teVaak(`login:${ipVan(c)}`, 20, KWARTIER)) throw new Fout(429, 'Te veel pogingen. Probeer het over een kwartier opnieuw.');
    const nieuw = nieuwToken();
    const { rows } = await c.get('db').query(
      'select auth_login_voltooien($1, $2, $3, $4, $5, $6) as uitkomst',
      [email, codeH, tokenH, c.get('sessie')?.hash ?? null, hash(nieuw), sessieVerloopt()]);
    if (!rows[0].uitkomst) return c.json({ fout: 'Deze code of link klopt niet of is verlopen. Vraag een nieuwe aan.' }, 400);
    if (rows[0].uitkomst === 'nieuw') zetSessieCookie(c, nieuw);
    return c.json({ ok: true });
  }
  app.post('/api/inloggen/code', async (c) => {
    const data = await invoer(c);
    const email = emailadres(data.email);
    const code = String(data.code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) throw new Fout(400, 'De code bestaat uit 6 cijfers.');
    return voltooiLogin(c, email, codeHash(email, code), null);
  });
  app.post('/api/inloggen/link', async (c) => {
    const data = await invoer(c);
    if (typeof data.token !== 'string' || !data.token) throw new Fout(400, 'Ongeldige link.');
    return voltooiLogin(c, null, null, hash(data.token));
  });

  app.post('/api/uitloggen', async (c) => {
    const sessie = c.get('sessie');
    if (sessie) await c.get('db').query('select auth_uitloggen($1)', [sessie.hash]);
    deleteCookie(c, COOKIE, { path: '/', secure: veilig });
    return c.json({ ok: true });
  });

  // ---- Wie ben ik en wat mag ik zien ---------------------------------------

  app.get('/api/ik', metSessie, async (c) => {
    const db = c.get('db');
    const leden = await db.query('select m.naam, m.email, m.rol, m.org_id, m.reis_id from mijn_leden() m order by m.naam');
    const organisaties = await db.query('select o.id, o.naam, is_beheerder(o.id) as beheerder from organisaties o order by o.naam');
    const reizen = await db.query(
      `select r.id, r.org_id, r.titel, r.ondertitel, r.start_datum, r.eind_datum, r.gearchiveerd, r.omslag, r.omslag_afbeelding_id,
              reis_rol(r.id) as rol, mag_reis_beheren(r.id, r.org_id) as mag_beheren
       from reizen r order by r.start_datum, r.titel`);
    return c.json({
      sessie_id: c.get('sessie').id,
      leden: leden.rows,
      organisaties: organisaties.rows,
      reizen: reizen.rows,
    });
  });

  // ---- Reizen ---------------------------------------------------------------

  function reisInvoer(data) {
    const start = datum(data.start_datum, 'De begindatum');
    const eind = datum(data.eind_datum, 'De einddatum');
    if (eind < start) throw new Fout(400, 'De einddatum ligt voor de begindatum.');
    if ((Date.parse(eind) - Date.parse(start)) / 86400000 > 120) throw new Fout(400, 'Een reis kan maximaal 120 dagen duren.');
    return {
      titel: tekst(data.titel, 'De naam van de reis', { max: 120, verplicht: true }),
      ondertitel: tekst(data.ondertitel, 'De ondertitel', { max: 200 }),
      omslag: OMSLAGEN.includes(data.omslag) ? data.omslag : 'zee',
      start, eind,
    };
  }
  const vulDagen = (db, orgId, reisId, start, eind) => db.query(
    `insert into programma_dagen (org_id, reis_id, datum)
     select $1, $2, d::date from generate_series($3::date, $4::date, interval '1 day') d
     on conflict (reis_id, datum) do nothing`, [orgId, reisId, start, eind]);

  app.post('/api/organisaties/:orgId/reizen', metSessie, async (c) => {
    const db = c.get('db');
    const orgId = uuid(c.req.param('orgId'));
    const r = reisInvoer(await invoer(c));
    const { rows: mag } = await db.query('select is_lid_van_org($1) as lid, is_beheerder($1) as beheerder', [orgId]);
    if (!mag[0].lid) throw new Fout(404, 'Niet gevonden.');
    if (!mag[0].beheerder) throw new Fout(403, 'Alleen een beheerder kan een reis aanmaken.');
    const { rows } = await db.query(
      `insert into reizen (org_id, titel, ondertitel, start_datum, eind_datum, omslag) values ($1, $2, $3, $4, $5, $6) returning id`,
      [orgId, r.titel, r.ondertitel, r.start, r.eind, r.omslag]);
    await vulDagen(db, orgId, rows[0].id, r.start, r.eind);
    return c.json({ id: rows[0].id }, 201);
  });

  app.put('/api/reizen/:reisId', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReis(db, c.req.param('reisId'));
    if (!reis.beheerder) throw new Fout(403, 'Alleen een beheerder kan de reisgegevens wijzigen.');
    const data = await invoer(c);
    const r = reisInvoer(data);
    const omslagFoto = fotoId(data.omslag_afbeelding_id);
    await db.query(
      `update reizen set titel = $2, ondertitel = $3, start_datum = $4, eind_datum = $5, gearchiveerd = $6, omslag = $7,
         omslag_afbeelding_id = $8 where id = $1`,
      [reis.id, r.titel, r.ondertitel, r.start, r.eind, bool(data.gearchiveerd), r.omslag, omslagFoto]);
    await ruimFotoOp(db, reis.omslag_afbeelding_id, omslagFoto);
    await vulDagen(db, reis.org_id, reis.id, r.start, r.eind);
    return c.json({ ok: true });
  });

  // Alles wat een deelnemer onderweg nodig heeft in één antwoord. De app bewaart
  // dit antwoord op het toestel, zodat het ook zonder verbinding beschikbaar is.
  app.get('/api/reizen/:reisId/bundel', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReis(db, c.req.param('reisId'));
    const dagen = await db.query(
      `select id, datum, titel, ondertitel, toelichting, afbeelding_id, bijgewerkt_op
       from programma_dagen where reis_id = $1 order by datum`, [reis.id]);
    const onderdelen = await db.query(
      `select id, dag_id, to_char(begin_tijd, 'HH24:MI') as begin_tijd, to_char(eind_tijd, 'HH24:MI') as eind_tijd,
              titel, omschrijving, to_char(verzameltijd, 'HH24:MI') as verzameltijd, verzamelpunt, meenemen,
              facultatief, afbeelding_id, bijgewerkt_op
       from programma_onderdelen where reis_id = $1
       order by coalesce(verzameltijd, begin_tijd) nulls first, titel`, [reis.id]);
    const info = await db.query(
      `select id, titel, tekst, volgorde, bijgewerkt_op from info_blokken where reis_id = $1 order by volgorde, titel`, [reis.id]);
    const berichten = await db.query(
      `select id, tekst, belangrijk, auteur_naam, afbeelding_id, geplaatst_op from berichten
       where reis_id = $1 order by geplaatst_op desc limit 200`, [reis.id]);
    const leiders = await db.query('select reis_groepsleiders($1) as naam', [reis.id]);
    const perDag = new Map(dagen.rows.map((d) => [d.id, { ...d, onderdelen: [] }]));
    for (const o of onderdelen.rows) perDag.get(o.dag_id)?.onderdelen.push(o);
    return c.json({
      reis,
      dagen: [...perDag.values()],
      info: info.rows,
      berichten: berichten.rows,
      groepsleiders: leiders.rows.map((r) => r.naam),
      opgehaald_op: new Date().toISOString(),
    });
  });

  // ---- Programma -------------------------------------------------------------

  const dagInvoer = (data) => ({
    foto: fotoId(data.afbeelding_id),
    titel: tekst(data.titel, 'De titel', { max: 120 }),
    ondertitel: tekst(data.ondertitel, 'De ondertitel', { max: 200 }),
    toelichting: tekst(data.toelichting, 'De toelichting', { max: 4000 }),
  });

  app.post('/api/reizen/:reisId/dagen', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const data = await invoer(c);
    const d = dagInvoer(data);
    const { rows } = await db.query(
      `insert into programma_dagen (org_id, reis_id, datum, titel, ondertitel, toelichting, afbeelding_id)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (reis_id, datum) do nothing returning id`,
      [reis.org_id, reis.id, datum(data.datum, 'De datum'), d.titel, d.ondertitel, d.toelichting, d.foto]);
    if (!rows[0]) throw new Fout(409, 'Voor deze datum bestaat al een dag in het programma.');
    return c.json({ id: rows[0].id }, 201);
  });

  app.put('/api/dagen/:id', metSessie, async (c) => {
    const db = c.get('db');
    const oud = await eisBeheerVan(db, 'dagen', c.req.param('id'));
    const d = dagInvoer(await invoer(c));
    await db.query('update programma_dagen set titel = $2, ondertitel = $3, toelichting = $4, afbeelding_id = $5 where id = $1',
      [c.req.param('id'), d.titel, d.ondertitel, d.toelichting, d.foto]);
    await ruimFotoOp(db, oud.afbeelding_id, d.foto);
    return c.json({ ok: true });
  });

  app.delete('/api/dagen/:id', metSessie, async (c) => {
    const db = c.get('db');
    const oud = await eisBeheerVan(db, 'dagen', c.req.param('id'));
    await db.query(`delete from afbeeldingen where id in (select afbeelding_id from programma_onderdelen where dag_id = $1)`, [c.req.param('id')]);
    await db.query('delete from programma_dagen where id = $1', [c.req.param('id')]);
    await ruimFotoOp(db, oud.afbeelding_id, null);
    return c.json({ ok: true });
  });

  const onderdeelInvoer = (data) => [
    tijd(data.begin_tijd, 'De begintijd'),
    tijd(data.eind_tijd, 'De eindtijd'),
    tekst(data.titel, 'De titel', { max: 160, verplicht: true }),
    tekst(data.omschrijving, 'De omschrijving', { max: 4000 }),
    tijd(data.verzameltijd, 'De verzameltijd'),
    tekst(data.verzamelpunt, 'Het verzamelpunt', { max: 500 }),
    tekst(data.meenemen, 'Meenemen', { max: 500 }),
    bool(data.facultatief),
    fotoId(data.afbeelding_id),
  ];

  app.post('/api/dagen/:dagId/onderdelen', metSessie, async (c) => {
    const db = c.get('db');
    const dag = await eisBeheerVan(db, 'dagen', c.req.param('dagId'));
    const velden = onderdeelInvoer(await invoer(c));
    const { rows } = await db.query(
      `insert into programma_onderdelen
         (org_id, reis_id, dag_id, begin_tijd, eind_tijd, titel, omschrijving, verzameltijd, verzamelpunt, meenemen, facultatief, afbeelding_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [dag.org_id, dag.reis_id, c.req.param('dagId'), ...velden]);
    return c.json({ id: rows[0].id }, 201);
  });

  app.put('/api/onderdelen/:id', metSessie, async (c) => {
    const db = c.get('db');
    const oud = await eisBeheerVan(db, 'onderdelen', c.req.param('id'));
    const velden = onderdeelInvoer(await invoer(c));
    await db.query(
      `update programma_onderdelen set begin_tijd = $2, eind_tijd = $3, titel = $4, omschrijving = $5,
         verzameltijd = $6, verzamelpunt = $7, meenemen = $8, facultatief = $9, afbeelding_id = $10 where id = $1`,
      [c.req.param('id'), ...velden]);
    await ruimFotoOp(db, oud.afbeelding_id, velden.at(-1));
    return c.json({ ok: true });
  });

  app.delete('/api/onderdelen/:id', metSessie, async (c) => {
    const db = c.get('db');
    const oud = await eisBeheerVan(db, 'onderdelen', c.req.param('id'));
    await db.query('delete from programma_onderdelen where id = $1', [c.req.param('id')]);
    await ruimFotoOp(db, oud.afbeelding_id, null);
    return c.json({ ok: true });
  });

  // ---- Praktische informatie ---------------------------------------------------

  const infoInvoer = (data) => [
    tekst(data.titel, 'De titel', { max: 160, verplicht: true }),
    tekst(data.tekst, 'De tekst', { max: 8000 }),
    Number.isInteger(data.volgorde) ? Math.max(-9999, Math.min(9999, data.volgorde)) : 0,
  ];

  app.post('/api/reizen/:reisId/info', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const { rows } = await db.query(
      'insert into info_blokken (org_id, reis_id, titel, tekst, volgorde) values ($1, $2, $3, $4, $5) returning id',
      [reis.org_id, reis.id, ...infoInvoer(await invoer(c))]);
    return c.json({ id: rows[0].id }, 201);
  });

  app.put('/api/info/:id', metSessie, async (c) => {
    const db = c.get('db');
    await eisBeheerVan(db, 'info', c.req.param('id'));
    await db.query('update info_blokken set titel = $2, tekst = $3, volgorde = $4 where id = $1',
      [c.req.param('id'), ...infoInvoer(await invoer(c))]);
    return c.json({ ok: true });
  });

  app.delete('/api/info/:id', metSessie, async (c) => {
    const db = c.get('db');
    await eisBeheerVan(db, 'info', c.req.param('id'));
    await db.query('delete from info_blokken where id = $1', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // ---- Berichten -----------------------------------------------------------------

  app.post('/api/reizen/:reisId/berichten', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const data = await invoer(c);
    const { rows: naam } = await db.query('select mijn_naam($1, $2) as naam', [reis.id, reis.org_id]);
    const { rows } = await db.query(
      `insert into berichten (org_id, reis_id, tekst, belangrijk, auteur_naam, afbeelding_id) values ($1, $2, $3, $4, $5, $6) returning id`,
      [reis.org_id, reis.id, tekst(data.tekst, 'Het bericht', { max: 4000, verplicht: true }), bool(data.belangrijk),
        naam[0].naam || 'Reisleiding', fotoId(data.afbeelding_id)]);
    return c.json({ id: rows[0].id }, 201);
  });

  app.delete('/api/berichten/:id', metSessie, async (c) => {
    const db = c.get('db');
    const oud = await eisBeheerVan(db, 'berichten', c.req.param('id'));
    await db.query('delete from berichten where id = $1', [c.req.param('id')]);
    await ruimFotoOp(db, oud.afbeelding_id, null);
    return c.json({ ok: true });
  });

  // ---- Groep: uitnodigen, intrekken, exporteren -------------------------------

  const LID_KOLOMMEN = `id, naam, email, rol, aangemaakt_op, geaccepteerd_op,
    case when ingetrokken_op is not null then 'ingetrokken'
         when geaccepteerd_op is not null then 'actief'
         when uitnodiging_verloopt_op < now() then 'verlopen'
         else 'uitgenodigd' end as status`;

  app.get('/api/reizen/:reisId/leden', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const { rows } = await db.query(
      `select ${LID_KOLOMMEN} from lidmaatschappen where reis_id = $1 order by (rol = 'groepsleider') desc, naam`, [reis.id]);
    // Een beheerder ziet hier ook de beheerders van de organisatie, om hun naam te kunnen aanpassen.
    const beheerders = reis.beheerder
      ? (await db.query(`select ${LID_KOLOMMEN} from lidmaatschappen where org_id = $1 and reis_id is null order by naam`, [reis.org_id])).rows
      : [];
    return c.json({ leden: rows, beheerders, mag_groepsleiders_beheren: reis.beheerder, mail_actief: mail.actief });
  });

  app.post('/api/reizen/:reisId/leden', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const data = await invoer(c);
    if (!Array.isArray(data.leden) || data.leden.length < 1 || data.leden.length > 200) {
      throw new Fout(400, 'Voeg 1 tot 200 personen per keer toe.');
    }
    const nieuw = data.leden.map((l) => ({
      naam: tekst(l?.naam, 'De naam', { max: 120, verplicht: true }),
      email: emailadres(l?.email),
      rol: l?.rol === 'groepsleider' ? 'groepsleider' : 'deelnemer',
    }));
    if (nieuw.some((l) => l.rol === 'groepsleider') && !reis.beheerder) {
      throw new Fout(403, 'Alleen een beheerder kan groepsleiders aanwijzen.');
    }
    const resultaat = [];
    for (const lid of nieuw) {
      const token = nieuwToken();
      const { rows } = await db.query(
        `insert into lidmaatschappen (org_id, reis_id, rol, email, naam, uitnodiging_hash, uitnodiging_verloopt_op)
         values ($1, $2, $3, $4, $5, $6, greatest(now() + interval '30 days', $7::date + 2))
         on conflict (reis_id, email) where reis_id is not null do nothing returning id`,
        [reis.org_id, reis.id, lid.rol, lid.email, lid.naam, hash(token), reis.eind_datum]);
      if (!rows[0]) {
        resultaat.push({ ...lid, status: 'bestond_al' });
        continue;
      }
      const link = `${adresVan(c)}/u/${token}`;
      const gemaild = await mail.stuur({
        aan: lid.email,
        ...uitnodigingsMail({ naam: lid.naam, reis: reis.titel, organisatie: reis.organisatie, link, rol: lid.rol }),
      });
      resultaat.push({ ...lid, id: rows[0].id, status: 'uitgenodigd', link, gemaild });
    }
    return c.json({ resultaat }, 201);
  });

  async function haalLid(db, id) {
    const { rows } = await db.query(
      `select l.id, l.naam, l.email, l.rol, l.reis_id, l.geaccepteerd_op, r.titel as reis, r.eind_datum, o.naam as organisatie
       from lidmaatschappen l join organisaties o on o.id = l.org_id left join reizen r on r.id = l.reis_id
       where l.id = $1`, [uuid(id)]);
    if (!rows[0]) throw new Fout(404, 'Niet gevonden.');
    return rows[0];
  }

  // De naam is wat deelnemers zien, bijvoorbeeld als afzender van een bericht.
  app.put('/api/leden/:id', metSessie, async (c) => {
    const db = c.get('db');
    const lid = await haalLid(db, c.req.param('id'));
    const naam = tekst((await invoer(c)).naam, 'De naam', { max: 120, verplicht: true });
    const { rows } = await db.query('update lidmaatschappen set naam = $2 where id = $1 returning id', [lid.id, naam]);
    if (!rows[0]) throw new Fout(403, 'Je kunt de naam van deze persoon niet wijzigen.');
    return c.json({ ok: true });
  });

  app.post('/api/leden/:id/nieuwe-link', metSessie, async (c) => {
    const db = c.get('db');
    const lid = await haalLid(db, c.req.param('id'));
    const token = nieuwToken();
    const { rows } = await db.query(
      `select lid_nieuwe_link($1, $2, greatest(now() + interval '30 days', $3::date + 2)) as gelukt`,
      [lid.id, hash(token), lid.eind_datum ?? new Date()]);
    if (!rows[0].gelukt) throw new Fout(403, 'Je kunt voor deze persoon geen nieuwe link maken.');
    const link = `${adresVan(c)}/u/${token}`;
    const gemaild = await mail.stuur({
      aan: lid.email,
      ...uitnodigingsMail({ naam: lid.naam, reis: lid.reis, organisatie: lid.organisatie, link, rol: lid.rol }),
    });
    return c.json({ link, gemaild });
  });

  app.post('/api/leden/:id/intrekken', metSessie, async (c) => {
    const db = c.get('db');
    const lid = await haalLid(db, c.req.param('id'));
    const { rows } = await db.query('select lid_intrekken($1) as gelukt', [lid.id]);
    if (!rows[0].gelukt) throw new Fout(403, 'Je kunt de toegang van deze persoon niet intrekken.');
    return c.json({ ok: true });
  });

  app.delete('/api/leden/:id', metSessie, async (c) => {
    const db = c.get('db');
    const lid = await haalLid(db, c.req.param('id'));
    if (lid.geaccepteerd_op) throw new Fout(409, 'Deze persoon heeft de app al geopend. Trek de toegang in.');
    const { rows } = await db.query('delete from lidmaatschappen where id = $1 and geaccepteerd_op is null returning id', [lid.id]);
    if (!rows[0]) throw new Fout(403, 'Je kunt deze persoon niet verwijderen.');
    return c.json({ ok: true });
  });

  app.get('/api/reizen/:reisId/deelnemers.csv', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const { rows } = await db.query(
      `select ${LID_KOLOMMEN} from lidmaatschappen where reis_id = $1 order by (rol = 'groepsleider') desc, naam`, [reis.id]);
    // Cellen die met = + - @ beginnen zou Excel als formule uitvoeren.
    const cel = (w) => {
      let s = w == null ? '' : String(w);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dag = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const regels = [['Naam', 'E-mail', 'Rol', 'Status', 'Uitgenodigd op', 'App geopend op'],
      ...rows.map((l) => [l.naam, l.email, l.rol, l.status, dag(l.aangemaakt_op), dag(l.geaccepteerd_op)])];
    const bestand = reis.titel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reis';
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="deelnemers-${bestand}.csv"`);
    return c.body(`﻿${regels.map((r) => r.map(cel).join(';')).join('\r\n')}\r\n`);
  });

  // ---- Foto's van de reisleiding ---------------------------------------------

  app.post('/api/reizen/:reisId/afbeeldingen', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReisVoorBeheer(db, c.req.param('reisId'));
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length > MAX_FOTO) throw new Fout(413, 'Deze foto is te groot. Kies een kleinere foto.');
    const soort = bytes.length >= 50 ? fotoSoort(bytes) : null;
    if (!soort) throw new Fout(400, 'Dit bestand is geen foto die de app kan tonen. Gebruik een JPG- of PNG-foto.');
    const { rows } = await db.query(
      'insert into afbeeldingen (org_id, reis_id, soort, gegevens) values ($1, $2, $3, $4) returning id',
      [reis.org_id, reis.id, soort, bytes]);
    return c.json({ id: rows[0].id }, 201);
  });

  app.get('/api/afbeeldingen/:id', metSessie, async (c) => {
    const { rows } = await c.get('db').query('select soort, gegevens from afbeeldingen where id = $1', [uuid(c.req.param('id'))]);
    if (!rows[0]) throw new Fout(404, 'Niet gevonden.');
    c.header('Content-Type', rows[0].soort);
    // Een foto verandert nooit (een nieuwe foto krijgt een nieuw adres), dus het
    // toestel mag hem bewaren. "private": alleen het toestel zelf, geen tussenstations.
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(rows[0].gegevens);
  });

  app.delete('/api/afbeeldingen/:id', metSessie, async (c) => {
    const db = c.get('db');
    await eisBeheerVan(db, 'afbeeldingen', c.req.param('id'));
    await db.query('delete from afbeeldingen where id = $1', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // Definitief verwijderen kan alleen bij een afgesloten reis.
  app.delete('/api/reizen/:reisId', metSessie, async (c) => {
    const db = c.get('db');
    const reis = await haalReis(db, c.req.param('reisId'));
    if (!reis.beheerder) throw new Fout(403, 'Alleen een beheerder kan een reis verwijderen.');
    if (!reis.gearchiveerd) throw new Fout(409, 'Sluit de reis eerst af. Daarna kun je hem verwijderen.');
    await db.query('delete from reizen where id = $1', [reis.id]);
    return c.json({ ok: true });
  });

  app.all('/api/*', (c) => c.json({ fout: 'Niet gevonden.' }, 404));

  // ---- De app zelf (statische bestanden) -----------------------------------

  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  };
  // Op Vercel serveert het CDN de bestanden uit public/ zelf en komen hier
  // alleen de schermadressen binnen (/reis/..., /u/...). De functie heeft dan
  // geen public-map bij zich en haalt index.html één keer bij het CDN op.
  let indexVanCdn = null;
  async function indexHtml(c) {
    const lokaal = path.join(publiekeMap, 'index.html');
    if (fs.existsSync(lokaal)) return fs.readFileSync(lokaal);
    if (!indexVanCdn) {
      const antwoord = await fetch(new URL('/index.html', c.req.url));
      if (!antwoord.ok) throw new Error(`index.html niet gevonden (${antwoord.status})`);
      indexVanCdn = Buffer.from(await antwoord.arrayBuffer());
    }
    return indexVanCdn;
  }

  app.get('*', async (c) => {
    const pad = decodeURIComponent(new URL(c.req.url).pathname);
    const bestand = path.join(publiekeMap, path.normalize(pad));
    const bestaat = bestand.startsWith(publiekeMap + path.sep) && TYPES[path.extname(bestand)]
      && fs.existsSync(bestand) && fs.statSync(bestand).isFile();
    c.header('Cache-Control', 'no-cache');
    if (bestaat) {
      c.header('Content-Type', TYPES[path.extname(bestand)]);
      return c.body(fs.readFileSync(bestand));
    }
    if (path.extname(pad)) return c.text('Niet gevonden.', 404);
    c.header('Content-Type', TYPES['.html']); // alle schermen lopen via de app
    return c.body(await indexHtml(c));
  });

  return app;
}

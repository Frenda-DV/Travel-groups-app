// Toegangsmatrix als test. Twee fictieve organisaties (Zonnevaart Reizen en
// Noorderlicht Tours), elk met twee reizen, groepsleiders en deelnemers.
//
// Deel 1 praat rechtstreeks met de database als de app-rol en stelt vragen
//        ZONDER enig filter. Wat dan terugkomt is wat row-level security toelaat.
// Deel 2 loopt elke combinatie van persoon x reis x API-actie langs.
// Deel 3 speelt de aanvallen en randgevallen na die bij uitnodigen horen.
//
// Geslaagd = geen enkele rij of wijziging buiten de eigen reizen.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  verseDatabase, zaai, startServer, maakVrager, PERSONAS, REIZEN, orgVan, vreemdeMerken, TESTFOTO,
} from './hulp.js';

let admin, app, zaad, server, vraag;
const q = (sql, p) => admin.query(sql, p).then((r) => r.rows);

before(async () => {
  ({ admin, app } = await verseDatabase('reisapp_test'));
  zaad = await zaai(admin);
  server = await startServer(app);
  vraag = maakVrager(server.url, zaad.tokens);
});
after(async () => {
  await server?.sluit();
  await app?.end();
  await admin?.end();
});

const heeftRecht = (persona, recht, reis) =>
  recht === 'beheerder' ? PERSONAS[persona].beheerder.includes(orgVan(reis)) : PERSONAS[persona][recht].includes(reis);

// Voer SQL uit als de app-rol, met de sessie van deze persoon. Alles wordt teruggedraaid.
async function alsPersona(persona, werk) {
  const client = await app.connect();
  try {
    await client.query('begin');
    const token = zaad.tokens[persona];
    if (token) await client.query("select set_config('app.sessie', $1, true)", [zaad.hash(token)]);
    return await werk(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}
// Lukt deze schrijfactie? Een weigering mag alleen "geen toegang" of "0 rijen" zijn.
async function lukt(client, sql, params = []) {
  await client.query('savepoint poging');
  try {
    const r = await client.query(sql, params);
    const waarde = r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    return r.command === 'SELECT' ? waarde === true : r.rowCount > 0;
  } catch (fout) {
    assert.ok(['42501', '23503'].includes(fout.code), `onverwachte fout ${fout.code}: ${fout.message}`);
    return false;
  } finally {
    await client.query('rollback to savepoint poging');
  }
}

// ===========================================================================
describe('1. Database: row-level security, vragen zonder filter', () => {
  const sorteer = (lijst) => [...lijst].sort();

  for (const persona of Object.keys(PERSONAS)) {
    test(`lezen: ${persona} ziet precies de eigen reizen (${PERSONAS[persona].lezen.join(', ') || 'niets'})`, async () => {
      const verwachteReizen = sorteer(PERSONAS[persona].lezen.map((r) => zaad.ids.reis[r]));
      const verwachteOrgs = sorteer([...new Set([...PERSONAS[persona].lezen.map(orgVan), ...PERSONAS[persona].beheerder])].map((o) => zaad.ids.org[o]));
      await alsPersona(persona, async (db) => {
        const kolom = async (sql) => (await db.query(sql)).rows.map((r) => Object.values(r)[0]);
        assert.deepEqual(sorteer(await kolom('select id from reizen')), verwachteReizen, 'reizen');
        assert.deepEqual(sorteer(await kolom('select id from organisaties')), verwachteOrgs, 'organisaties');
        for (const [tabel, perReis] of [['programma_dagen', 2], ['programma_onderdelen', 4], ['info_blokken', 1], ['berichten', 2], ['afbeeldingen', 1]]) {
          const rijen = await kolom(`select reis_id from ${tabel}`);
          assert.deepEqual(sorteer([...new Set(rijen)]), verwachteReizen, `${tabel}: reizen`);
          assert.equal(rijen.length, verwachteReizen.length * perReis, `${tabel}: aantal rijen`);
        }
      });
    });
  }

  test('lezen: deelnemers zien alleen zichzelf, groepsleiders hun reis, beheerders hun organisatie', async () => {
    const alle = await q('select id, org_id, reis_id from lidmaatschappen');
    const eigen = { gerda: ['gerdaA1', 'gerdaB1'], dirk: [], henk: [], nep: [], anoniem: [] };
    for (const persona of Object.keys(PERSONAS)) {
      const p = PERSONAS[persona];
      const verwacht = new Set((eigen[persona] ?? [persona]).map((k) => zaad.ids.lid[k]));
      for (const l of alle) {
        if (p.beheerder.some((o) => zaad.ids.org[o] === l.org_id)) verwacht.add(l.id);
        if (p.beheren.some((r) => zaad.ids.reis[r] === l.reis_id) && !p.beheerder.length) verwacht.add(l.id);
      }
      const gezien = await alsPersona(persona, async (db) => (await db.query('select id from lidmaatschappen')).rows.map((r) => r.id));
      assert.deepEqual(gezien.sort(), [...verwacht].sort(), `lidmaatschappen zichtbaar voor ${persona}`);
    }
  });

  const doelDeelnemer = { A1: 'bram', A2: 'cor', B1: 'eva', B2: 'fien' };
  const doelLeider = { A1: 'leiderA1', A2: 'leiderA2', B1: 'leiderB1' };
  const schrijfacties = [
    ['bericht plaatsen', 'beheren', (r) => [`insert into berichten (org_id, reis_id, tekst, auteur_naam) values ($1, $2, 'x', 'y')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r]]]],
    ['bericht verwijderen', 'beheren', (r) => ['delete from berichten where reis_id = $1', [zaad.ids.reis[r]]]],
    ['dag toevoegen', 'beheren', (r) => [`insert into programma_dagen (org_id, reis_id, datum) values ($1, $2, '2029-01-01')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r]]]],
    ['dag wijzigen', 'beheren', (r) => [`update programma_dagen set titel = 'gekaapt' where reis_id = $1`, [zaad.ids.reis[r]]]],
    ['dag verwijderen', 'beheren', (r) => ['delete from programma_dagen where reis_id = $1', [zaad.ids.reis[r]]]],
    ['onderdeel toevoegen', 'beheren', (r) => [`insert into programma_onderdelen (org_id, reis_id, dag_id, titel) values ($1, $2, $3, 'x')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r], zaad.ids.dag[`${r}.1`]]]],
    ['onderdeel wijzigen', 'beheren', (r) => [`update programma_onderdelen set verzamelpunt = 'gekaapt' where reis_id = $1`, [zaad.ids.reis[r]]]],
    ['onderdeel verwijderen', 'beheren', (r) => ['delete from programma_onderdelen where reis_id = $1', [zaad.ids.reis[r]]]],
    ['foto toevoegen', 'beheren', (r) => [`insert into afbeeldingen (org_id, reis_id, soort, gegevens) values ($1, $2, 'image/jpeg', $3)`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r], TESTFOTO]]],
    ['foto verwijderen', 'beheren', (r) => ['delete from afbeeldingen where reis_id = $1', [zaad.ids.reis[r]]]],
    ['foto aan onderdeel koppelen', 'beheren', (r) => ['update programma_onderdelen set afbeelding_id = $2 where reis_id = $1', [zaad.ids.reis[r], zaad.ids.foto[r]]]],
    ['info toevoegen', 'beheren', (r) => [`insert into info_blokken (org_id, reis_id, titel) values ($1, $2, 'x')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r]]]],
    ['info wijzigen', 'beheren', (r) => [`update info_blokken set tekst = 'gekaapt' where reis_id = $1`, [zaad.ids.reis[r]]]],
    ['info verwijderen', 'beheren', (r) => ['delete from info_blokken where reis_id = $1', [zaad.ids.reis[r]]]],
    ['deelnemer uitnodigen', 'beheren', (r) => [`insert into lidmaatschappen (org_id, reis_id, rol, email, naam) values ($1, $2, 'deelnemer', 'nieuw@x.test', 'Nieuw')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r]]]],
    ['naam deelnemer wijzigen', 'beheren', (r) => [`update lidmaatschappen set naam = 'gekaapt' where reis_id = $1 and rol = 'deelnemer'`, [zaad.ids.reis[r]]]],
    ['groepsleider aanwijzen', 'beheerder', (r) => [`insert into lidmaatschappen (org_id, reis_id, rol, email, naam) values ($1, $2, 'groepsleider', 'nieuw@x.test', 'Nieuw')`, [zaad.ids.org[orgVan(r)], zaad.ids.reis[r]]]],
    ['reisgegevens wijzigen', 'beheerder', (r) => [`update reizen set titel = 'gekaapt' where id = $1`, [zaad.ids.reis[r]]]],
    ['reis aanmaken', 'beheerder', (r) => [`insert into reizen (org_id, titel, start_datum, eind_datum) values ($1, 'x', '2029-01-01', '2029-01-02')`, [zaad.ids.org[orgVan(r)]]]],
  ];

  for (const persona of Object.keys(PERSONAS)) {
    test(`schrijven: ${persona} kan alleen wijzigen wat de matrix toestaat`, async () => {
      await alsPersona(persona, async (db) => {
        for (const reis of REIZEN) {
          for (const [naam, recht, maak] of schrijfacties) {
            const [sql, params] = maak(reis);
            assert.equal(await lukt(db, sql, params), heeftRecht(persona, recht, reis), `${persona}: ${naam} in ${reis}`);
          }
          // Toegang intrekken en nieuwe link lopen via functies met een eigen controle.
          for (const [doel, recht] of [[doelDeelnemer[reis], 'beheren'], [doelLeider[reis], 'beheerder']]) {
            if (!doel) continue;
            const mag = heeftRecht(persona, recht, reis) && persona !== doel;
            assert.equal(await lukt(db, 'select lid_intrekken($1)', [zaad.ids.lid[doel]]), mag, `${persona}: toegang intrekken van ${doel}`);
            assert.equal(await lukt(db, `select lid_nieuwe_link($1, 'h', now() + interval '1 day')`, [zaad.ids.lid[doel]]), mag, `${persona}: nieuwe link voor ${doel}`);
          }
        }
      });
    });
  }

  test('sessies, inlogcodes en gevoelige kolommen zijn voor de app-rol onbereikbaar', async () => {
    const verboden = [
      'select * from sessies', 'select * from sessie_toegang', 'select * from login_tokens',
      'delete from sessies', `insert into sessie_toegang select token_hash, '${zaad.ids.lid.beheerderB}' from sessies`,
      `update lidmaatschappen set rol = 'groepsleider'`, 'update lidmaatschappen set ingetrokken_op = null',
      'update lidmaatschappen set reis_id = null', `update lidmaatschappen set uitnodiging_hash = 'x'`,
      `update lidmaatschappen set email = 'x@x.test'`,
      `insert into organisaties (naam) values ('x')`, `update organisaties set naam = 'x'`,
      `update berichten set tekst = 'x'`, `update programma_onderdelen set reis_id = '${zaad.ids.reis.A1}'`,
      `update afbeeldingen set soort = 'image/png'`, `update afbeeldingen set reis_id = '${zaad.ids.reis.A1}'`,
      `update programma_dagen set org_id = '${zaad.ids.org.A}'`,
    ];
    for (const persona of ['beheerderA', 'leiderB1', 'anna', 'anoniem']) {
      await alsPersona(persona, async (db) => {
        for (const sql of verboden) {
          await db.query('savepoint v');
          await assert.rejects(db.query(sql), { code: '42501' }, `${persona}: ${sql}`);
          await db.query('rollback to savepoint v');
        }
      });
    }
  });

  test('gegevens van de ene organisatie zijn niet aan een reis van de andere te hangen', async () => {
    const { org, reis, dag } = zaad.ids;
    await alsPersona('beheerderA', async (db) => {
      for (const [sql, params] of [
        [`insert into berichten (org_id, reis_id, tekst, auteur_naam) values ($1, $2, 'x', 'y')`, [org.A, reis.B1]],
        [`insert into berichten (org_id, reis_id, tekst, auteur_naam) values ($1, $2, 'x', 'y')`, [org.B, reis.B1]],
        [`insert into programma_onderdelen (org_id, reis_id, dag_id, titel) values ($1, $2, $3, 'x')`, [org.A, reis.A1, dag['B1.1']]],
        [`insert into lidmaatschappen (org_id, reis_id, rol, email, naam) values ($1, $2, 'groepsleider', 'x@x.test', 'x')`, [org.A, reis.B1]],
        [`insert into lidmaatschappen (org_id, rol, email, naam) values ($1, 'beheerder', 'x@x.test', 'x')`, [org.B]],
        // een reis die niet is afgesloten kan niemand verwijderen, ook de beheerder niet
        ['delete from reizen', []],
        // een foto van een andere reis (zelfs binnen de eigen organisatie) is niet te koppelen
        ['update programma_onderdelen set afbeelding_id = $1 where reis_id = $2', [zaad.ids.foto.A2, reis.A1]],
        ['update programma_onderdelen set afbeelding_id = $1 where reis_id = $2', [zaad.ids.foto.B1, reis.A1]],
        ['update reizen set omslag_afbeelding_id = $1 where id = $2', [zaad.ids.foto.B1, reis.A1]],
      ]) assert.equal(await lukt(db, sql, params), false, sql);
    });
  });
});

// ===========================================================================
describe('2. API: elke persoon x elke reis x elke actie', () => {
  let teller = 0;
  const merk = (r) => `#${r}#`;
  const o = (r) => zaad.ids.org[orgVan(r)];
  const verseDag = async (r) => (await q(
    `insert into programma_dagen (org_id, reis_id, datum, titel) values ($1, $2, date '2031-01-01' + $3::int, $4) returning id`,
    [o(r), zaad.ids.reis[r], teller++, `Doel ${merk(r)}`]))[0].id;
  const versOnderdeel = async (r) => (await q(
    `insert into programma_onderdelen (org_id, reis_id, dag_id, titel) values ($1, $2, $3, $4) returning id`,
    [o(r), zaad.ids.reis[r], zaad.ids.dag[`${r}.1`], `Doel ${merk(r)}`]))[0].id;
  const verseInfo = async (r) => (await q(
    `insert into info_blokken (org_id, reis_id, titel) values ($1, $2, $3) returning id`, [o(r), zaad.ids.reis[r], `Doel ${merk(r)}`]))[0].id;
  const versBericht = async (r) => (await q(
    `insert into berichten (org_id, reis_id, tekst, auteur_naam) values ($1, $2, $3, 'x') returning id`, [o(r), zaad.ids.reis[r], `Doel ${merk(r)}`]))[0].id;
  const versLid = async (r, rol, geaccepteerd = true) => (await q(
    `insert into lidmaatschappen (org_id, reis_id, rol, email, naam, geaccepteerd_op) values ($1, $2, $3, $4, $5, $6) returning id`,
    [o(r), zaad.ids.reis[r], rol, `doel${teller++}@${r.toLowerCase()}.test`, `Doel ${merk(r)}`, geaccepteerd ? new Date() : null]))[0].id;
  const bestaat = async (tabel, id) => (await q(`select 1 from ${tabel} where id = $1`, [id])).length === 1;
  const veld = async (tabel, kolom, id) => (await q(`select ${kolom} as v from ${tabel} where id = $1`, [id]))[0]?.v;

  // [naam, benodigd recht, voorbereiding -> { methode, pad, body, effect() }]
  const acties = [
    ['programma, info en berichten ophalen', 'lezen', async (r) => ({ methode: 'GET', pad: `/api/reizen/${zaad.ids.reis[r]}/bundel` })],
    ['foto van de reisleiding bekijken', 'lezen', async (r) => ({ methode: 'GET', pad: `/api/afbeeldingen/${zaad.ids.foto[r]}`, binair: true })],
    ['foto toevoegen', 'beheren', async (r) => {
      const voor = (await q('select count(*)::int as n from afbeeldingen where reis_id = $1', [zaad.ids.reis[r]]))[0].n;
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/afbeeldingen`, body: TESTFOTO,
        effect: async () => (await q('select count(*)::int as n from afbeeldingen where reis_id = $1', [zaad.ids.reis[r]]))[0].n === voor + 1,
        opruimen: () => q('delete from afbeeldingen where reis_id = $1 and id <> $2', [zaad.ids.reis[r], zaad.ids.foto[r]]) };
    }],
    ['foto verwijderen', 'beheren', async (r) => {
      const id = (await q(`insert into afbeeldingen (org_id, reis_id, soort, gegevens) values ($1, $2, 'image/jpeg', $3) returning id`, [o(r), zaad.ids.reis[r], TESTFOTO]))[0].id;
      return { methode: 'DELETE', pad: `/api/afbeeldingen/${id}`, effect: async () => !(await bestaat('afbeeldingen', id)),
        opruimen: () => q('delete from afbeeldingen where id = $1', [id]) };
    }],
    ['afgesloten reis definitief verwijderen', 'beheerder', async (r) => {
      const id = (await q(
        `insert into reizen (org_id, titel, start_datum, eind_datum, gearchiveerd) values ($1, $2, '2028-06-01', '2028-06-02', true) returning id`,
        [o(r), `Afgesloten #${orgVan(r)}#`]))[0].id;
      return { methode: 'DELETE', pad: `/api/reizen/${id}`, effect: async () => !(await bestaat('reizen', id)),
        opruimen: () => q('delete from reizen where id = $1', [id]) };
    }],
    ['deelnemerslijst bekijken', 'beheren', async (r) => ({ methode: 'GET', pad: `/api/reizen/${zaad.ids.reis[r]}/leden` })],
    ['deelnemerslijst exporteren (csv)', 'beheren', async (r) => ({ methode: 'GET', pad: `/api/reizen/${zaad.ids.reis[r]}/deelnemers.csv` })],
    ['dag toevoegen', 'beheren', async (r) => {
      const datum = new Date(Date.UTC(2032, 0, 1 + teller++)).toISOString().slice(0, 10);
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/dagen`, body: { datum, titel: `Nieuw ${merk(r)}` },
        effect: async () => (await q('select 1 from programma_dagen where reis_id = $1 and datum = $2', [zaad.ids.reis[r], datum])).length === 1 };
    }],
    ['dag wijzigen', 'beheren', async (r) => {
      const id = await verseDag(r);
      return { methode: 'PUT', pad: `/api/dagen/${id}`, body: { titel: `Gewijzigd ${merk(r)}` }, effect: async () => (await veld('programma_dagen', 'titel', id)).startsWith('Gewijzigd') };
    }],
    ['dag verwijderen', 'beheren', async (r) => {
      const id = await verseDag(r);
      return { methode: 'DELETE', pad: `/api/dagen/${id}`, effect: async () => !(await bestaat('programma_dagen', id)) };
    }],
    ['onderdeel toevoegen', 'beheren', async (r) => {
      const dag = await verseDag(r);
      return { methode: 'POST', pad: `/api/dagen/${dag}/onderdelen`, body: { titel: `Nieuw ${merk(r)}`, begin_tijd: '10:00', verzameltijd: '09:45', verzamelpunt: 'Kade' },
        effect: async () => (await q('select 1 from programma_onderdelen where dag_id = $1', [dag])).length === 1 };
    }],
    ['onderdeel wijzigen (tijd en verzamelpunt)', 'beheren', async (r) => {
      const id = await versOnderdeel(r);
      return { methode: 'PUT', pad: `/api/onderdelen/${id}`, body: { titel: `Doel ${merk(r)}`, begin_tijd: '11:30', verzamelpunt: 'Gewijzigd' }, effect: async () => (await veld('programma_onderdelen', 'verzamelpunt', id)) === 'Gewijzigd' };
    }],
    ['onderdeel verwijderen', 'beheren', async (r) => {
      const id = await versOnderdeel(r);
      return { methode: 'DELETE', pad: `/api/onderdelen/${id}`, effect: async () => !(await bestaat('programma_onderdelen', id)) };
    }],
    ['praktische info toevoegen', 'beheren', async (r) => {
      const titel = `Nieuw ${teller++} ${merk(r)}`;
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/info`, body: { titel, tekst: 'x' },
        effect: async () => (await q('select 1 from info_blokken where reis_id = $1 and titel = $2', [zaad.ids.reis[r], titel])).length === 1 };
    }],
    ['praktische info wijzigen', 'beheren', async (r) => {
      const id = await verseInfo(r);
      return { methode: 'PUT', pad: `/api/info/${id}`, body: { titel: `Doel ${merk(r)}`, tekst: 'Gewijzigd' }, effect: async () => (await veld('info_blokken', 'tekst', id)) === 'Gewijzigd' };
    }],
    ['praktische info verwijderen', 'beheren', async (r) => {
      const id = await verseInfo(r);
      return { methode: 'DELETE', pad: `/api/info/${id}`, effect: async () => !(await bestaat('info_blokken', id)) };
    }],
    ['bericht plaatsen', 'beheren', async (r) => {
      const tekst = `Nieuw ${teller++} ${merk(r)}`;
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/berichten`, body: { tekst, belangrijk: true },
        effect: async () => (await q('select 1 from berichten where reis_id = $1 and tekst = $2', [zaad.ids.reis[r], tekst])).length === 1 };
    }],
    ['bericht verwijderen', 'beheren', async (r) => {
      const id = await versBericht(r);
      return { methode: 'DELETE', pad: `/api/berichten/${id}`, effect: async () => !(await bestaat('berichten', id)) };
    }],
    ['deelnemer uitnodigen', 'beheren', async (r) => {
      const email = `nieuw${teller++}@${r.toLowerCase()}.test`;
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/leden`, body: { leden: [{ naam: `Nieuw ${merk(r)}`, email }] },
        effect: async () => (await q('select 1 from lidmaatschappen where email = $1', [email])).length === 1 };
    }],
    ['groepsleider aanwijzen', 'beheerder', async (r) => {
      const email = `leider${teller++}@${r.toLowerCase()}.test`;
      return { methode: 'POST', pad: `/api/reizen/${zaad.ids.reis[r]}/leden`, body: { leden: [{ naam: `Nieuw ${merk(r)}`, email, rol: 'groepsleider' }] },
        effect: async () => (await q('select 1 from lidmaatschappen where email = $1', [email])).length === 1,
        opruimen: () => q('delete from lidmaatschappen where email = $1', [email]) };
    }],
    ['naam van een deelnemer wijzigen', 'beheren', async (r) => {
      const id = await versLid(r, 'deelnemer');
      return { methode: 'PUT', pad: `/api/leden/${id}`, body: { naam: `Hernoemd ${merk(r)}` }, effect: async () => (await veld('lidmaatschappen', 'naam', id)).startsWith('Hernoemd') };
    }],
    ['naam van een groepsleider wijzigen', 'beheerder', async (r) => {
      const id = await versLid(r, 'groepsleider');
      return { methode: 'PUT', pad: `/api/leden/${id}`, body: { naam: `Hernoemd ${merk(r)}` }, effect: async () => (await veld('lidmaatschappen', 'naam', id)).startsWith('Hernoemd'),
        opruimen: () => q('delete from lidmaatschappen where id = $1', [id]) };
    }],
    ['nieuwe link voor deelnemer', 'beheren', async (r) => {
      const id = await versLid(r, 'deelnemer');
      return { methode: 'POST', pad: `/api/leden/${id}/nieuwe-link`, effect: async () => (await veld('lidmaatschappen', 'uitnodiging_hash', id)) != null };
    }],
    ['nieuwe link voor groepsleider', 'beheerder', async (r) => {
      const id = await versLid(r, 'groepsleider');
      return { methode: 'POST', pad: `/api/leden/${id}/nieuwe-link`, effect: async () => (await veld('lidmaatschappen', 'uitnodiging_hash', id)) != null,
        opruimen: () => q('delete from lidmaatschappen where id = $1', [id]) };
    }],
    ['toegang deelnemer intrekken', 'beheren', async (r) => {
      const id = await versLid(r, 'deelnemer');
      return { methode: 'POST', pad: `/api/leden/${id}/intrekken`, effect: async () => (await veld('lidmaatschappen', 'ingetrokken_op', id)) != null };
    }],
    ['toegang groepsleider intrekken', 'beheerder', async (r) => {
      const id = await versLid(r, 'groepsleider');
      return { methode: 'POST', pad: `/api/leden/${id}/intrekken`, effect: async () => (await veld('lidmaatschappen', 'ingetrokken_op', id)) != null,
        opruimen: () => q('delete from lidmaatschappen where id = $1', [id]) };
    }],
    ['ongeopende uitnodiging verwijderen', 'beheren', async (r) => {
      const id = await versLid(r, 'deelnemer', false);
      return { methode: 'DELETE', pad: `/api/leden/${id}`, effect: async () => !(await bestaat('lidmaatschappen', id)) };
    }],
    ['reisgegevens wijzigen', 'beheerder', async (r) => {
      const id = zaad.ids.reis[r];
      const oud = await veld('reizen', 'titel', id);
      return { methode: 'PUT', pad: `/api/reizen/${id}`, body: { titel: `Hernoemd ${merk(r)}`, start_datum: '2027-05-10', eind_datum: '2027-05-12' },
        effect: async () => (await veld('reizen', 'titel', id)).startsWith('Hernoemd'),
        opruimen: () => q('update reizen set titel = $2 where id = $1', [id, oud]) };
    }],
    ['reis aanmaken', 'beheerder', async (r) => {
      const titel = `Nieuwe reis ${teller++} #${orgVan(r)}#`;
      return { methode: 'POST', pad: `/api/organisaties/${o(r)}/reizen`, body: { titel, start_datum: '2028-03-01', eind_datum: '2028-03-03' },
        effect: async () => (await q('select 1 from reizen where titel = $1', [titel])).length === 1,
        opruimen: () => q('delete from reizen where titel = $1', [titel]) };
    }],
  ];

  let aantal = 0;
  for (const persona of Object.keys(PERSONAS)) {
    test(`${persona}: ${acties.length} acties op ${REIZEN.length} reizen`, async () => {
      const zonderSessie = ['anoniem', 'nep', 'henk'].includes(persona);
      for (const reis of REIZEN) {
        for (const [naam, recht, bereidVoor] of acties) {
          const actie = await bereidVoor(reis);
          const mag = heeftRecht(persona, recht, reis);
          const wat = `${persona} / ${reis} / ${naam}`;
          const antwoord = await vraag(persona, actie.methode, actie.pad, actie.body);
          aantal += 1;
          if (mag) {
            assert.ok([200, 201].includes(antwoord.status), `${wat}: verwacht toegestaan, kreeg ${antwoord.status} ${antwoord.tekst.slice(0, 120)}`);
            if (actie.binair) assert.equal(antwoord.soort, 'image/jpeg', `${wat}: geen foto teruggekregen`);
            else if (actie.methode === 'GET') assert.ok(antwoord.tekst.includes(merk(reis)), `${wat}: antwoord bevat de eigen reis niet`);
          } else if (zonderSessie) {
            assert.equal(antwoord.status, 401, `${wat}: zonder geldige sessie hoort 401`);
          } else {
            assert.ok([403, 404].includes(antwoord.status), `${wat}: verwacht geweigerd, kreeg ${antwoord.status}`);
          }
          assert.deepEqual(vreemdeMerken(antwoord.tekst, persona), [], `${wat}: LEK, antwoord bevat gegevens van een andere reis of organisatie`);
          if (actie.effect) assert.equal(await actie.effect(), mag, `${wat}: wijziging ${mag ? 'niet doorgevoerd' : 'TOCH doorgevoerd'}`);
          await actie.opruimen?.();
        }
      }
    });
  }

  test('overzicht "mijn reizen" toont per persoon alleen de eigen reizen', async () => {
    for (const persona of Object.keys(PERSONAS)) {
      const antwoord = await vraag(persona, 'GET', '/api/ik');
      if (['anoniem', 'nep', 'henk'].includes(persona)) { assert.equal(antwoord.status, 401, persona); continue; }
      assert.equal(antwoord.status, 200);
      assert.deepEqual(antwoord.json.reizen.map((r) => r.id).sort(), PERSONAS[persona].lezen.map((r) => zaad.ids.reis[r]).sort(), persona);
      assert.deepEqual(vreemdeMerken(antwoord.tekst, persona), [], `${persona}: lek in /api/ik`);
    }
    console.log(`    (${aantal} API-aanvragen gecontroleerd op status, effect en lekken)`);
  });

  test('een deelnemer krijgt geen e-mailadressen of namen van andere deelnemers', async () => {
    const antwoord = await vraag('anna', 'GET', `/api/reizen/${zaad.ids.reis.A1}/bundel`);
    assert.equal(antwoord.status, 200);
    assert.ok(!antwoord.tekst.includes('.test'), 'bundel bevat een e-mailadres');
    assert.ok(!antwoord.tekst.includes('Bram') && !antwoord.tekst.includes('Gerda'), 'bundel bevat namen van andere deelnemers');
    assert.deepEqual(antwoord.json.groepsleiders, ['Leider Lotte #A1#']);
  });
});

// ===========================================================================
describe('3. Uitnodigen, inloggen en intrekken', () => {
  const tokenUit = (link) => link.split('/u/')[1];
  async function nodigUit(wie, reis, lid) {
    const antwoord = await vraag(wie, 'POST', `/api/reizen/${zaad.ids.reis[reis]}/leden`, { leden: [lid] });
    assert.equal(antwoord.status, 201, antwoord.tekst);
    return antwoord.json.resultaat[0];
  }
  async function accepteer(link, cookie) {
    return vraag(cookie ? { cookie } : null, 'POST', `/api/uitnodigingen/${tokenUit(link)}/accepteren`);
  }

  test('uitnodiging: persoonlijk, werkt één keer en geeft alleen die ene reis', async () => {
    const uitnodiging = await nodigUit('leiderA1', 'A1', { naam: 'Ineke #A1#', email: 'ineke@a1.test' });
    assert.equal(uitnodiging.status, 'uitgenodigd');
    assert.equal(server.mail.postbus.at(-1).aan, 'ineke@a1.test');
    assert.ok(server.mail.postbus.at(-1).tekst.includes(uitnodiging.link));

    const kijk = await vraag(null, 'GET', `/api/uitnodigingen/${tokenUit(uitnodiging.link)}`);
    assert.equal(kijk.json.status, 'geldig');
    assert.equal(kijk.json.naam, 'Ineke #A1#');

    const eerste = await accepteer(uitnodiging.link);
    assert.equal(eerste.status, 200);
    assert.ok(eerste.cookie, 'sessiecookie gezet');
    const ik = await vraag({ cookie: eerste.cookie }, 'GET', '/api/ik');
    assert.deepEqual(ik.json.reizen.map((r) => r.id), [zaad.ids.reis.A1]);
    assert.equal((await vraag({ cookie: eerste.cookie }, 'GET', `/api/reizen/${zaad.ids.reis.A2}/bundel`)).status, 404);
    assert.equal((await vraag({ cookie: eerste.cookie }, 'GET', `/api/reizen/${zaad.ids.reis.B1}/bundel`)).status, 404);

    const tweede = await accepteer(uitnodiging.link);
    assert.equal(tweede.status, 410, 'tweede gebruik van dezelfde link wordt geweigerd');
    assert.equal(tweede.cookie, null);
    assert.equal((await vraag(null, 'GET', `/api/uitnodigingen/${tokenUit(uitnodiging.link)}`)).json.status, 'gebruikt');
  });

  test('uitnodiging: verlopen, ingetrokken of verzonnen links geven geen toegang', async () => {
    const verlopen = await nodigUit('leiderA1', 'A1', { naam: 'Jan #A1#', email: 'jan@a1.test' });
    await q(`update lidmaatschappen set uitnodiging_verloopt_op = now() - interval '1 minute' where id = $1`, [verlopen.id]);
    assert.equal((await accepteer(verlopen.link)).status, 410);

    const ingetrokken = await nodigUit('leiderA1', 'A1', { naam: 'Kees #A1#', email: 'kees@a1.test' });
    assert.equal((await vraag('leiderA1', 'POST', `/api/leden/${ingetrokken.id}/intrekken`)).status, 200);
    assert.equal((await accepteer(ingetrokken.link)).status, 410);

    assert.equal((await vraag(null, 'GET', '/api/uitnodigingen/verzonnen-token')).status, 404);
    assert.equal((await accepteer('x/u/verzonnen-token')).status, 410);
  });

  test('aanval: groepsleider nodigt het adres van de beheerder uit en gebruikt de link zelf', async () => {
    const link = (await nodigUit('leiderA1', 'A1', { naam: 'Nep-beheerder #A1#', email: 'beheer@a.test' })).link;
    const sessie = await accepteer(link);
    const ik = await vraag({ cookie: sessie.cookie }, 'GET', '/api/ik');
    assert.deepEqual(ik.json.reizen.map((r) => r.id), [zaad.ids.reis.A1], 'alleen de reis uit de uitnodiging');
    assert.equal(ik.json.organisaties.some((o) => o.beheerder), false, 'geen beheerdersrechten');
    assert.equal((await vraag({ cookie: sessie.cookie }, 'GET', `/api/reizen/${zaad.ids.reis.A2}/bundel`)).status, 404);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'POST', `/api/organisaties/${zaad.ids.org.A}/reizen`,
      { titel: 'x', start_datum: '2028-01-01', eind_datum: '2028-01-02' })).status, 403);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'GET', `/api/reizen/${zaad.ids.reis.A1}/leden`)).status, 403);
  });

  test('aanval: groepsleider van organisatie B nodigt een deelnemer van organisatie A uit', async () => {
    const link = (await nodigUit('leiderB1', 'B1', { naam: 'Anna-kloon #B1#', email: 'anna@a1.test' })).link;
    const sessie = await accepteer(link);
    const ik = await vraag({ cookie: sessie.cookie }, 'GET', '/api/ik');
    assert.deepEqual(ik.json.reizen.map((r) => r.id), [zaad.ids.reis.B1]);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'GET', `/api/reizen/${zaad.ids.reis.A1}/bundel`)).status, 404, 'geen toegang tot Anna\'s reis bij A');
    assert.ok(!/#A[12]?#/.test(ik.tekst), 'geen gegevens van organisatie A in het antwoord');
  });

  test('gedeeld toestel van een echtpaar: twee uitnodigingen, één toestel', async () => {
    const een = await accepteer((await nodigUit('leiderA2', 'A2', { naam: 'Mies #A2#', email: 'mies@a2.test' })).link);
    const twee = await accepteer((await nodigUit('leiderA2', 'A2', { naam: 'Nico #A2#', email: 'nico@a2.test' })).link, een.cookie);
    assert.equal(twee.status, 200);
    assert.equal(twee.cookie, null, 'bestaande sessie blijft in gebruik');
    const ik = await vraag({ cookie: een.cookie }, 'GET', '/api/ik');
    assert.deepEqual(ik.json.leden.map((l) => l.naam).sort(), ['Mies #A2#', 'Nico #A2#']);
    assert.deepEqual(ik.json.reizen.map((r) => r.id), [zaad.ids.reis.A2]);
  });

  test('inloggen met e-mailcode: alle eigen reizen, maximaal 5 pogingen, onbekende adressen krijgen niets', async () => {
    const aantalMails = server.mail.postbus.length;
    assert.equal((await vraag(null, 'POST', '/api/inloggen/aanvragen', { email: 'niemand@nergens.test' })).status, 200);
    assert.equal(server.mail.postbus.length, aantalMails, 'geen mail naar onbekend adres');

    assert.equal((await vraag(null, 'POST', '/api/inloggen/aanvragen', { email: 'Gerda@Dubbel.test ' })).status, 200);
    let mail = server.mail.postbus.at(-1);
    assert.equal(mail.aan, 'gerda@dubbel.test');
    let code = mail.tekst.match(/inlogcode is: (\d{6})/)[1];
    const fout = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await vraag(null, 'POST', '/api/inloggen/code', { email: 'gerda@dubbel.test', code: fout })).status, 400);
    }
    assert.equal((await vraag(null, 'POST', '/api/inloggen/code', { email: 'gerda@dubbel.test', code })).status, 400, 'na 5 foute pogingen is ook de goede code geblokkeerd');

    await vraag(null, 'POST', '/api/inloggen/aanvragen', { email: 'gerda@dubbel.test' });
    mail = server.mail.postbus.at(-1);
    code = mail.tekst.match(/inlogcode is: (\d{6})/)[1];
    const goed = await vraag(null, 'POST', '/api/inloggen/code', { email: 'gerda@dubbel.test', code });
    assert.equal(goed.status, 200);
    const ik = await vraag({ cookie: goed.cookie }, 'GET', '/api/ik');
    assert.deepEqual(ik.json.reizen.map((r) => r.id).sort(), [zaad.ids.reis.A1, zaad.ids.reis.B1].sort());
    assert.deepEqual(vreemdeMerken(ik.tekst, 'gerda'), []);
    assert.equal((await vraag(null, 'POST', '/api/inloggen/code', { email: 'gerda@dubbel.test', code })).status, 400, 'code werkt één keer');
  });

  test('inloggen met de link uit de mail werkt één keer', async () => {
    await vraag(null, 'POST', '/api/inloggen/aanvragen', { email: 'eva@b1.test' });
    const token = server.mail.postbus.at(-1).tekst.match(/\/l\/(\S+)/)[1];
    const eerste = await vraag(null, 'POST', '/api/inloggen/link', { token });
    assert.equal(eerste.status, 200);
    assert.deepEqual((await vraag({ cookie: eerste.cookie }, 'GET', '/api/ik')).json.reizen.map((r) => r.id), [zaad.ids.reis.B1]);
    assert.equal((await vraag(null, 'POST', '/api/inloggen/link', { token })).status, 400);
  });

  test('toegang intrekken werkt direct; een nieuwe link maakt oude toestellen ongeldig', async () => {
    const bundel = `/api/reizen/${zaad.ids.reis.A1}/bundel`;
    assert.equal((await vraag('bram', 'GET', bundel)).status, 200);
    assert.equal((await vraag('leiderA1', 'POST', `/api/leden/${zaad.ids.lid.bram}/intrekken`)).status, 200);
    assert.equal((await vraag('bram', 'GET', bundel)).status, 404, 'direct geen toegang meer');
    assert.deepEqual((await vraag('bram', 'GET', '/api/ik')).json.reizen, []);

    const nieuw = await vraag('leiderA1', 'POST', `/api/leden/${zaad.ids.lid.bram}/nieuwe-link`);
    assert.equal(nieuw.status, 200);
    assert.equal((await vraag('bram', 'GET', bundel)).status, 404, 'het oude toestel (verloren telefoon) krijgt geen toegang terug');
    const nieuwToestel = await accepteer(nieuw.json.link);
    assert.equal((await vraag({ cookie: nieuwToestel.cookie }, 'GET', bundel)).status, 200, 'het nieuwe toestel wel');
  });

  test('een groepsleider kan zichzelf niet buitensluiten en geen groepsleiders aanwijzen', async () => {
    assert.equal((await vraag('leiderA1', 'POST', `/api/leden/${zaad.ids.lid.leiderA1}/intrekken`)).status, 403);
    assert.equal((await vraag('beheerderA', 'POST', `/api/leden/${zaad.ids.lid.beheerderA}/intrekken`)).status, 403);
    const antwoord = await vraag('leiderA1', 'POST', `/api/reizen/${zaad.ids.reis.A1}/leden`, { leden: [{ naam: 'x', email: 'x@a1.test', rol: 'groepsleider' }] });
    assert.equal(antwoord.status, 403);
  });

  test('aanvragen vanaf een andere website worden geweigerd', async () => {
    const voor = (await q('select count(*)::int as n from berichten where reis_id = $1', [zaad.ids.reis.A1]))[0].n;
    const antwoord = await vraag('leiderA1', 'POST', `/api/reizen/${zaad.ids.reis.A1}/berichten`, { tekst: 'kwaad' }, { origin: 'https://kwaad.example' });
    assert.equal(antwoord.status, 403);
    assert.equal((await q('select count(*)::int as n from berichten where reis_id = $1', [zaad.ids.reis.A1]))[0].n, voor);
  });

  test('export: alleen de eigen reis, en Excel-formules worden onschadelijk gemaakt', async () => {
    await nodigUit('leiderA1', 'A1', { naam: '=HYPERLINK("http://kwaad")', email: 'formule@a1.test' });
    const csv = await vraag('leiderA1', 'GET', `/api/reizen/${zaad.ids.reis.A1}/deelnemers.csv`);
    assert.equal(csv.status, 200);
    assert.ok(csv.tekst.includes('anna@a1.test'));
    assert.ok(csv.tekst.includes(`"'=HYPERLINK(""http://kwaad"")"`), 'formule is voorzien van een apostrof');
    assert.deepEqual(vreemdeMerken(csv.tekst, 'leiderA1'), []);
    assert.ok(!csv.tekst.includes('cor@a2.test'));
  });

  test("foto's: alleen echte foto's, niet te groot, en opgeruimd als ze nergens meer bij horen", async () => {
    const reis = zaad.ids.reis.B1;
    const tel = async () => (await q('select count(*)::int as n from afbeeldingen where reis_id = $1', [reis]))[0].n;
    const voor = await tel();
    assert.equal((await vraag('leiderB1', 'POST', `/api/reizen/${reis}/afbeeldingen`, Buffer.from('<script>alert(1)</script>'.repeat(5)))).status, 400, 'geen foto');
    assert.equal((await vraag('leiderB1', 'POST', `/api/reizen/${reis}/afbeeldingen`, Buffer.concat([TESTFOTO, Buffer.alloc(700000)]))).status, 413, 'te groot');
    assert.equal(await tel(), voor);

    const foto = (await vraag('leiderB1', 'POST', `/api/reizen/${reis}/afbeeldingen`, TESTFOTO)).json.id;
    const bericht = await vraag('leiderB1', 'POST', `/api/reizen/${reis}/berichten`, { tekst: 'Zo ziet het trefpunt eruit #B1#', afbeelding_id: foto });
    assert.equal(bericht.status, 201);
    const bundel = await vraag('eva', 'GET', `/api/reizen/${reis}/bundel`);
    assert.equal(bundel.json.berichten[0].afbeelding_id, foto, 'deelnemer krijgt de foto bij het bericht');
    const opgehaald = await vraag('eva', 'GET', `/api/afbeeldingen/${foto}`);
    assert.equal(opgehaald.status, 200);
    assert.match(opgehaald.soort, /image\/jpeg/);

    // een foto van een andere reis koppelen wordt geweigerd
    const vreemd = await vraag('leiderB1', 'POST', `/api/reizen/${reis}/berichten`, { tekst: 'x', afbeelding_id: zaad.ids.foto.A1 });
    assert.ok([400, 404].includes(vreemd.status), `foto van een andere reis: ${vreemd.status}`);

    assert.equal((await vraag('leiderB1', 'DELETE', `/api/berichten/${bericht.json.id}`)).status, 200);
    assert.equal((await q('select 1 from afbeeldingen where id = $1', [foto])).length, 0, 'foto verdwijnt met het bericht');
    assert.equal((await vraag('eva', 'GET', `/api/afbeeldingen/${foto}`)).status, 404);
  });

  test('namen: de beheerder past de eigen naam aan en die staat daarna bij nieuwe berichten', async () => {
    const reis = zaad.ids.reis.B1;
    const lijst = await vraag('beheerderB', 'GET', `/api/reizen/${reis}/leden`);
    assert.deepEqual(lijst.json.beheerders.map((b) => b.email), ['beheer@b.test'], 'beheerder ziet de beheerders van de eigen organisatie');
    assert.deepEqual((await vraag('leiderB1', 'GET', `/api/reizen/${reis}/leden`)).json.beheerders, [], 'een groepsleider ziet de beheerders niet');
    assert.equal((await vraag('beheerderB', 'PUT', `/api/leden/${zaad.ids.lid.beheerderB}`, { naam: 'Bente van Noorderlicht #B#' })).status, 200);
    assert.equal((await vraag('beheerderB', 'PUT', `/api/leden/${zaad.ids.lid.beheerderB}`, { naam: '   ' })).status, 400, 'een lege naam mag niet');
    await vraag('beheerderB', 'POST', `/api/reizen/${reis}/berichten`, { tekst: 'Tot morgen #B1#' });
    const bundel = await vraag('eva', 'GET', `/api/reizen/${reis}/bundel`);
    assert.equal(bundel.json.berichten[0].auteur_naam, 'Bente van Noorderlicht #B#');
    // een groepsleider kan de eigen naam en die van de beheerder niet wijzigen, een deelnemer niets
    assert.equal((await vraag('leiderB1', 'PUT', `/api/leden/${zaad.ids.lid.leiderB1}`, { naam: 'x' })).status, 403);
    assert.equal((await vraag('leiderB1', 'PUT', `/api/leden/${zaad.ids.lid.beheerderB}`, { naam: 'x' })).status, 404);
    assert.equal((await vraag('eva', 'PUT', `/api/leden/${zaad.ids.lid.eva}`, { naam: 'x' })).status, 403);
    assert.equal((await vraag('beheerderA', 'PUT', `/api/leden/${zaad.ids.lid.eva}`, { naam: 'x' })).status, 404, 'andere organisatie');
  });

  test('uitloggen maakt de sessie ongeldig', async () => {
    const sessie = await accepteer((await nodigUit('leiderB1', 'B1', { naam: 'Olga #B1#', email: 'olga@b1.test' })).link);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'GET', '/api/ik')).status, 200);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'POST', '/api/uitloggen')).status, 200);
    assert.equal((await vraag({ cookie: sessie.cookie }, 'GET', '/api/ik')).status, 401);
  });

  test('een gearchiveerde reis is dicht voor deelnemers en groepsleiders', async () => {
    const id = zaad.ids.reis.A2;
    const body = { titel: 'Douro Portugal #A2#', start_datum: '2027-05-10', eind_datum: '2027-05-12', gearchiveerd: true };
    assert.equal((await vraag('beheerderA', 'PUT', `/api/reizen/${id}`, body)).status, 200);
    assert.equal((await vraag('cor', 'GET', `/api/reizen/${id}/bundel`)).status, 404);
    assert.equal((await vraag('leiderA2', 'GET', `/api/reizen/${id}/bundel`)).status, 404);
    assert.equal((await vraag('leiderA2', 'POST', `/api/reizen/${id}/berichten`, { tekst: 'x' })).status, 404);
    assert.equal((await vraag('beheerderA', 'GET', `/api/reizen/${id}/bundel`)).status, 200);
  });
});

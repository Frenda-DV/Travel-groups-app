// Browsertests: de app zoals een deelnemer en een groepsleider hem gebruiken,
// op telefoonformaat, met twee fictieve reisorganisaties.
//
// Vereist Playwright met Chromium (zie README). De tests gebruiken dezelfde
// fictieve gegevens en merktekens (#A1#, #B1# ...) als de toegangstests.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verseDatabase, zaai, startServer, maakVrager } from '../test/hulp.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const axeBron = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const afdrukken = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schermafdrukken');
fs.mkdirSync(afdrukken, { recursive: true });

let admin, app, zaad, server, vraag, browser;
const telefoon = { ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' };
// De fictieve reizen lopen van 10 tot en met 12 mei 2027. Het is "nu" de eerste ochtend.
const REISOCHTEND = new Date('2027-05-10T08:30:00+02:00');

before(async () => {
  ({ admin, app } = await verseDatabase('reisapp_e2e'));
  zaad = await zaai(admin);
  server = await startServer(app);
  vraag = maakVrager(server.url, zaad.tokens);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.sluit();
  await app?.end();
  await admin?.end();
});

// ---- Hulpjes ---------------------------------------------------------------

async function nieuwToestel({ als, opties = telefoon, tijd = REISOCHTEND } = {}) {
  const context = await browser.newContext(opties);
  if (als) await context.addCookies([{ name: 'sessie', value: zaad.tokens[als], url: server.url }]);
  const pagina = await context.newPage();
  const fouten = [];
  pagina.on('pageerror', (e) => fouten.push(e.message));
  pagina.on('dialog', (d) => d.accept());
  if (tijd) await pagina.clock.install({ time: tijd });
  return { context, pagina, fouten };
}
const reisPad = (reis, tab = 'programma') => `${server.url}/reis/${zaad.ids.reis[reis]}/${tab}`;
const foto = (pagina, naam) => pagina.screenshot({ path: path.join(afdrukken, `${naam}.png`) });

async function nodigUitViaApi(wie, reis, naam, email, rol = 'deelnemer') {
  const antwoord = await vraag(wie, 'POST', `/api/reizen/${zaad.ids.reis[reis]}/leden`, { leden: [{ naam, email, rol }] });
  assert.equal(antwoord.status, 201, antwoord.tekst);
  return antwoord.json.resultaat[0];
}
async function openUitnodiging(pagina, link) {
  await pagina.goto(link);
  await pagina.getByRole('button', { name: 'Open mijn reis' }).click();
  await pagina.locator('.dag').waitFor();
}
// De app werkt pas zonder internet als de service worker de pagina bestuurt.
async function wachtOpOfflineKlaar(pagina) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((klaar) => navigator.serviceWorker.addEventListener('controllerchange', klaar, { once: true }));
    }
  });
}
// Alles wat de app op het toestel bewaart, als één tekst om in te zoeken.
const opslagInhoud = (pagina) => pagina.evaluate(() => new Promise((klaar) => {
  const verzoek = indexedDB.open('mee-op-reis');
  verzoek.onsuccess = () => {
    const db = verzoek.result;
    if (!db.objectStoreNames.contains('kv')) return klaar({ sleutels: [], tekst: '' });
    const winkel = db.transaction('kv').objectStore('kv');
    const s = winkel.getAllKeys();
    const w = winkel.getAll();
    w.onsuccess = () => klaar({ sleutels: s.result, tekst: JSON.stringify(w.result) });
  };
  verzoek.onerror = () => klaar({ sleutels: [], tekst: '' });
}));
const schermTekst = (pagina) => pagina.locator('body').innerText();

// ===========================================================================
describe('Deelnemer en groepsleider, op de eerste ochtend van de reis', () => {
  let leider, deelnemer, uitnodiging;

  test('groepsleider nodigt een deelnemer uit vanuit de app', async () => {
    leider = await nieuwToestel({ als: 'leiderA1', opties: { viewport: { width: 1000, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' } });
    await leider.pagina.goto(reisPad('A1', 'beheer'));
    await leider.pagina.getByRole('button', { name: 'Personen uitnodigen' }).click();
    await leider.pagina.getByLabel('Naam en e-mailadres').fill('Truus Test\ttruus@a1.test\nWim Test <wim@a1.test>');
    assert.equal(await leider.pagina.getByText('Groepsleider (mag').count(), 0, 'een groepsleider kan geen groepsleiders aanwijzen');
    await leider.pagina.getByRole('button', { name: 'Nodig uit' }).click();
    await leider.pagina.locator('.linklijst li').nth(1).waitFor();
    const links = await leider.pagina.locator('.linklijst code').allInnerTexts();
    assert.equal(links.length, 2);
    uitnodiging = links[0];
    assert.match(uitnodiging, /\/u\/[\w-]{40,}$/);
    await leider.pagina.getByText('Truus Test').first().waitFor();
    await foto(leider.pagina, 'leider-uitnodigen');
  });

  test('deelnemer opent de persoonlijke link en ziet direct waar en hoe laat', async () => {
    deelnemer = await nieuwToestel();
    await deelnemer.pagina.goto(uitnodiging);
    await deelnemer.pagina.getByRole('heading', { name: 'Welkom, Truus Test' }).waitFor();
    await foto(deelnemer.pagina, 'deelnemer-uitnodiging');
    await deelnemer.pagina.getByRole('button', { name: 'Open mijn reis' }).click();

    const eerst = deelnemer.pagina.getByRole('region', { name: 'Eerstvolgende' });
    await eerst.waitFor();
    const tekst = await eerst.innerText();
    assert.match(tekst, /Aanwezig om 09:00/);
    assert.match(tekst, /Stadswandeling/);
    assert.match(tekst, /begint om 09:15/);
    assert.match(tekst, /Bij de loopplank, gids met rode paraplu/);
    assert.match(await deelnemer.pagina.locator('.dag-kop').innerText(), /maandag 10 mei \(vandaag\)/i);
    await foto(deelnemer.pagina, 'deelnemer-programma');

    // Geen beheerfuncties voor een deelnemer.
    assert.equal(await deelnemer.pagina.getByRole('link', { name: 'Groep' }).count(), 0);
    assert.equal(await deelnemer.pagina.getByRole('button', { name: /Wijzig|toevoegen/ }).count(), 0);
  });

  test('zonder verbinding: programma met tijden en verzamelpunten blijft beschikbaar', async () => {
    const { pagina, context } = deelnemer;
    await wachtOpOfflineKlaar(pagina);
    await context.setOffline(true);
    await pagina.reload();

    await pagina.getByRole('region', { name: 'Eerstvolgende' }).waitFor();
    const status = await pagina.locator('.status.offline').innerText();
    assert.match(status, /Geen verbinding/);
    assert.match(status, /opgehaald vandaag om 08:3\d/, 'toont wanneer het programma is opgehaald');
    const dag1 = await schermTekst(pagina);
    for (const verwacht of ['09:15', 'tot 12:30', 'Aanwezig om 09:00', 'Bij de loopplank, gids met rode paraplu #A1#', '14:00', 'Aanwezig om 13:45', 'Receptie dek 3 #A1#']) {
      assert.ok(dag1.includes(verwacht), `offline ontbreekt: ${verwacht}`);
    }
    await foto(pagina, 'deelnemer-offline');

    await pagina.getByRole('button', { name: /11 mei/ }).click();
    assert.match(await pagina.locator('.dag-kop').innerText(), /Dag 2 #A1#/);
    assert.ok((await schermTekst(pagina)).includes('Bij de loopplank'), 'ook de volgende dag is offline te lezen');

    await pagina.getByRole('link', { name: /Info/ }).click();
    assert.ok((await schermTekst(pagina)).includes('Noodnummer #A1#'));
    await pagina.getByRole('link', { name: /Berichten/ }).click();
    assert.ok((await schermTekst(pagina)).includes('Bericht 2 #A1#'));
  });

  test('zonder verbinding: privénotities werken en blijven op het toestel', async () => {
    const { pagina } = deelnemer;
    await pagina.getByRole('link', { name: /Notities/ }).click();
    await pagina.getByLabel('Mijn notities').fill('Hut 4012, tafel om 18:00');
    await pagina.getByText(/Bewaard op dit toestel/).waitFor();
    await pagina.reload();
    await pagina.getByRole('link', { name: /Notities/ }).click();
    assert.equal(await pagina.getByLabel('Mijn notities').inputValue(), 'Hut 4012, tafel om 18:00');
    const { rows } = await admin.query(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name ilike '%notitie%'`);
    assert.equal(rows[0].n, 0, 'de server heeft geen plek voor notities');
  });

  test('groepsleider wijzigt verzamelpunt, schrapt een onderdeel en plaatst een belangrijk bericht', async () => {
    const { pagina } = leider;
    await pagina.goto(reisPad('A1'));
    await pagina.getByRole('button', { name: 'Wijzig Stadswandeling #A1#' }).click();
    await pagina.getByLabel('Aanwezig om').fill('08:45');
    await pagina.getByLabel('Verzamelpunt').fill('Ingang terminal B, bij de blauwe vlag #A1#');
    await pagina.getByRole('button', { name: 'Bewaar' }).click();
    await pagina.getByText('Ingang terminal B, bij de blauwe vlag').first().waitFor();

    await pagina.getByRole('button', { name: 'Wijzig Excursie museum #A1#' }).click();
    await pagina.getByRole('button', { name: 'Haal uit programma' }).click();
    await pagina.getByRole('button', { name: 'Wijzig Excursie museum #A1#' }).waitFor({ state: 'detached' });

    await pagina.getByRole('link', { name: /Berichten/ }).click();
    await pagina.getByLabel('Nieuw bericht aan de groep').fill('De bus vertrekt een kwartier eerder #A1#');
    await pagina.getByLabel(/Belangrijk/).check();
    await pagina.getByRole('button', { name: 'Plaats bericht' }).click();
    await pagina.getByText('Je bericht is geplaatst.').waitFor();
    const geplaatst = pagina.locator('.bericht', { hasText: 'De bus vertrekt een kwartier eerder' });
    await geplaatst.waitFor();
    assert.match(await geplaatst.innerText(), /Leider Lotte #A1#/, 'het bericht draagt de naam van de groepsleider');
    await foto(pagina, 'leider-berichten');
  });

  test('weer verbinding: deelnemer ziet wat er gewijzigd en vervallen is', async () => {
    const { pagina, context } = deelnemer;
    await context.setOffline(false);
    await pagina.goto(reisPad('A1'));
    const balk = pagina.getByRole('region', { name: 'Wijzigingen in het programma' });
    await balk.waitFor();
    const balkTekst = await balk.innerText();
    assert.match(balkTekst, /Het programma is gewijzigd/);
    assert.match(balkTekst, /Vervallen: 14:00 Excursie museum #A1# \(maandag 10 mei\)/);
    assert.match(await pagina.getByRole('region', { name: 'Eerstvolgende' }).innerText(), /Aanwezig om 08:45[\s\S]*Ingang terminal B/);
    assert.match(await pagina.locator('.onderdeel.gemarkeerd').innerText(), /Gewijzigd/);
    assert.match(await pagina.locator('.belangrijk-balk').innerText(), /De bus vertrekt een kwartier eerder/);
    assert.match(await pagina.locator('.tabs .teller').innerText(), /^1/);
    await foto(pagina, 'deelnemer-gewijzigd');

    await balk.getByRole('button', { name: 'Begrepen' }).click();
    await balk.waitFor({ state: 'detached' });
    await pagina.locator('.belangrijk-balk').click();
    await pagina.getByText('De bus vertrekt een kwartier eerder').waitFor();
    await pagina.getByRole('link', { name: /Programma/ }).click();
    assert.equal(await pagina.locator('.belangrijk-balk').count(), 0, 'gelezen bericht staat niet meer boven het programma');
    assert.deepEqual(deelnemer.fouten, [], 'geen scriptfouten bij de deelnemer');
    assert.deepEqual(leider.fouten, [], 'geen scriptfouten bij de groepsleider');
  });

  test('deelnemer komt niet bij een andere reis of een andere organisatie', async () => {
    const { pagina } = deelnemer;
    for (const reis of ['A2', 'B1', 'B2']) {
      await pagina.goto(reisPad(reis));
      await pagina.getByRole('heading', { name: 'Geen toegang' }).waitFor();
      assert.ok(!/#(A2|B1|B2|B)#/.test(await schermTekst(pagina)), `scherm toont gegevens van ${reis}`);
    }
    await pagina.goto(reisPad('A1', 'beheer'));
    await pagina.locator('.dag').waitFor();
    assert.equal(await pagina.getByRole('heading', { name: 'Groep' }).count(), 0, 'het groepsscherm opent niet voor een deelnemer');
    const opslag = await opslagInhoud(pagina);
    assert.ok(!/#(A2|B1|B2|B)#/.test(opslag.tekst), 'opslag op het toestel bevat alleen de eigen reis');
  });
});

// ===========================================================================
describe('Twee organisaties op één toestel', () => {
  let toestel;

  test('uitloggen wist het toestel; daarna is er ook offline niets meer te zien', async () => {
    toestel = await nieuwToestel();
    const link = (await nodigUitViaApi('leiderA1', 'A1', 'Piet #A1#', 'piet@a1.test')).link;
    await openUitnodiging(toestel.pagina, link);
    await wachtOpOfflineKlaar(toestel.pagina);
    assert.ok((await opslagInhoud(toestel.pagina)).tekst.includes('#A1#'), 'programma staat op het toestel');

    await toestel.pagina.getByRole('link', { name: /Info/ }).click();
    await toestel.pagina.getByRole('button', { name: 'Uitloggen' }).click();
    await toestel.pagina.getByRole('heading', { name: 'Inloggen' }).waitFor();
    assert.deepEqual((await opslagInhoud(toestel.pagina)).sleutels, [], 'opslag is leeg na uitloggen');

    await toestel.context.setOffline(true);
    await toestel.pagina.goto(reisPad('A1'));
    await toestel.pagina.getByRole('heading', { name: 'Inloggen' }).waitFor();
    assert.ok(!(await schermTekst(toestel.pagina)).includes('#A1#'));
    await toestel.context.setOffline(false);
  });

  test('de volgende gebruiker, van een andere organisatie, ziet alleen de eigen reis', async () => {
    const link = (await nodigUitViaApi('leiderB1', 'B1', 'Quinta #B1#', 'quinta@b1.test')).link;
    await openUitnodiging(toestel.pagina, link);
    assert.match(await toestel.pagina.locator('.kop').innerText(), /Noorderlicht Tours #B#[\s\S]*Noorse kust #B1#/);
    await wachtOpOfflineKlaar(toestel.pagina);
    await toestel.context.setOffline(true);
    await toestel.pagina.reload();
    await toestel.pagina.getByRole('region', { name: 'Eerstvolgende' }).waitFor();
    assert.ok((await schermTekst(toestel.pagina)).includes('Bij de loopplank, gids met rode paraplu #B1#'));
    const opslag = await opslagInhoud(toestel.pagina);
    assert.ok(opslag.tekst.includes('#B1#'));
    assert.ok(!/#(A1|A2|A|B2)#/.test(opslag.tekst), 'geen spoor van organisatie A of een andere reis op het toestel');
    await toestel.pagina.goto(reisPad('A1'));
    assert.ok(!(await schermTekst(toestel.pagina)).includes('#A1#'), 'ook offline is de reis van de vorige gebruiker niet op te vragen');
    await toestel.context.setOffline(false);
    assert.deepEqual(toestel.fouten, []);
  });

  test('toegang ingetrokken: de kopie op het toestel wordt gewist', async () => {
    const mens = await nieuwToestel();
    const uitnodiging = await nodigUitViaApi('leiderB1', 'B1', 'Rob #B1#', 'rob@b1.test');
    await openUitnodiging(mens.pagina, uitnodiging.link);
    await wachtOpOfflineKlaar(mens.pagina);
    assert.ok((await opslagInhoud(mens.pagina)).tekst.includes('#B1#'));

    const leider = await nieuwToestel({ als: 'leiderB1' });
    await leider.pagina.goto(reisPad('B1', 'beheer'));
    await leider.pagina.getByRole('button', { name: 'Toegang intrekken van Rob #B1#' }).click();
    await leider.pagina.locator('.lid', { hasText: 'Rob #B1#' }).getByText('Toegang ingetrokken').waitFor();

    await mens.pagina.reload();
    await mens.pagina.getByRole('heading', { name: 'Geen toegang' }).waitFor();
    assert.ok(!(await opslagInhoud(mens.pagina)).tekst.includes('#B1#'), 'programma is van het toestel verwijderd');
    await mens.context.setOffline(true);
    await mens.pagina.reload();
    await mens.pagina.locator('main').waitFor();
    assert.ok(!(await schermTekst(mens.pagina)).includes('Bij de loopplank'), 'ook offline is er niets meer te zien');
    await mens.context.close();
    await leider.context.close();
  });

  test('inloggen met e-mailcode toont de reizen bij beide organisaties, en niets anders', async () => {
    const mens = await nieuwToestel();
    await mens.pagina.goto(`${server.url}/`);
    await mens.pagina.getByLabel('E-mailadres').fill('gerda@dubbel.test');
    await mens.pagina.getByRole('button', { name: 'Stuur mij een inlogcode' }).click();
    await mens.pagina.getByLabel('Inlogcode').waitFor();
    const code = server.mail.postbus.at(-1).tekst.match(/inlogcode is: (\d{6})/)[1];
    await mens.pagina.getByLabel('Inlogcode').fill(code);
    await mens.pagina.getByRole('button', { name: 'Log in' }).click();
    await mens.pagina.getByRole('heading', { name: 'Mijn reizen' }).waitFor();
    const tekst = await schermTekst(mens.pagina);
    assert.ok(tekst.includes('Rijncruise Keulen #A1#') && tekst.includes('Noorse kust #B1#'));
    assert.ok(!/#(A2|B2)#/.test(tekst));
    await foto(mens.pagina, 'mijn-reizen');
    await mens.context.close();
  });
});

// ===========================================================================
describe('Beheerder: meerdere reizen en groepsleiders', () => {
  test('beheerder maakt een reis aan, wijst een groepsleider aan en die vult het programma', async () => {
    const beheerder = await nieuwToestel({ als: 'beheerderB', opties: { viewport: { width: 1000, height: 900 }, locale: 'nl-NL' }, tijd: null });
    await beheerder.pagina.goto(`${server.url}/`);
    await beheerder.pagina.getByRole('heading', { name: 'Mijn reizen' }).waitFor();
    assert.equal(await beheerder.pagina.locator('.reiskaart').count(), 2, 'beheerder ziet beide reizen van de eigen organisatie');
    await beheerder.pagina.getByRole('button', { name: /Nieuwe reis voor Noorderlicht/ }).click();
    await beheerder.pagina.getByLabel('Naam van de reis').fill('Lofoten voorjaar #B#');
    await beheerder.pagina.getByLabel('Eerste dag').fill('2028-04-03');
    await beheerder.pagina.getByLabel('Laatste dag').fill('2028-04-06');
    await beheerder.pagina.getByRole('button', { name: 'Bewaar' }).click();
    await beheerder.pagina.getByRole('heading', { name: 'Groep', exact: true }).waitFor();

    await beheerder.pagina.getByRole('button', { name: 'Personen uitnodigen' }).click();
    await beheerder.pagina.getByLabel('Naam en e-mailadres').fill('Sanne Leider, sanne@b.test');
    await beheerder.pagina.getByRole('radio', { name: /Groepsleider/ }).check();
    await beheerder.pagina.getByRole('button', { name: 'Nodig uit' }).click();
    const link = await beheerder.pagina.locator('.linklijst code').innerText();
    await foto(beheerder.pagina, 'beheerder-groepsleider');

    const leider = await nieuwToestel({ tijd: null });
    await openUitnodiging(leider.pagina, link);
    assert.equal(await leider.pagina.locator('.dagknop').count(), 4, 'voor elke reisdag staat een lege dag klaar');
    await leider.pagina.getByRole('button', { name: 'Onderdeel toevoegen' }).click();
    await leider.pagina.getByLabel('Wat').fill('Welkomstborrel');
    await leider.pagina.getByLabel('Begintijd').fill('17:00');
    await leider.pagina.getByLabel('Aanwezig om').fill('16:50');
    await leider.pagina.getByLabel('Verzamelpunt').fill('Lobby van het hotel');
    await leider.pagina.getByRole('button', { name: 'Bewaar' }).click();
    await leider.pagina.locator('.onderdeel', { hasText: 'Welkomstborrel' }).waitFor();
    assert.match(await leider.pagina.locator('.onderdeel').innerText(), /17:00[\s\S]*Aanwezig om 16:50[\s\S]*Lobby van het hotel/);
    await foto(leider.pagina, 'leider-telefoon');
    assert.deepEqual([...beheerder.fouten, ...leider.fouten], []);
    await beheerder.context.close();
    await leider.context.close();
  });
});

// ===========================================================================
describe('Installeerbaar en toegankelijk', () => {
  test('Chrome keurt de app goed als installeerbare app', async () => {
    const { pagina, context } = await nieuwToestel({ als: 'anna', tijd: null });
    await pagina.goto(reisPad('A1'));
    await pagina.locator('.dag').waitFor();
    await wachtOpOfflineKlaar(pagina);
    const cdp = await context.newCDPSession(pagina);
    const manifest = await cdp.send('Page.getAppManifest');
    assert.deepEqual(manifest.errors, [], 'manifest zonder fouten');
    assert.match(manifest.data, /"display": "standalone"/);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, [], 'geen installatiebezwaren volgens Chrome');
    for (const icoon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      assert.equal((await pagina.request.get(`${server.url}/icons/${icoon}`)).status(), 200, icoon);
    }
    await context.close();
  });

  test('axe-core vindt geen ernstige toegankelijkheidsproblemen (WCAG 2.1 AA)', async () => {
    const bevindingen = [];
    async function controleer(pagina, scherm) {
      await pagina.addScriptTag({ content: axeBron });
      const uitkomst = await pagina.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
      for (const v of uitkomst.violations) bevindingen.push({ scherm, regel: v.id, ernst: v.impact, waar: v.nodes.map((n) => n.target.join(' ')).slice(0, 3) });
    }

    // axe wordt als script in de pagina gezet; alleen in deze test mag dat langs de CSP van de app.
    const metAxe = { ...telefoon, bypassCSP: true };
    const gast = await nieuwToestel({ opties: metAxe });
    await gast.pagina.goto(`${server.url}/inloggen`);
    await gast.pagina.getByRole('heading', { name: 'Inloggen' }).waitFor();
    await controleer(gast.pagina, 'inloggen');
    const link = (await nodigUitViaApi('leiderA1', 'A1', 'Tine #A1#', 'tine@a1.test')).link;
    await gast.pagina.goto(link);
    await gast.pagina.getByRole('button', { name: 'Open mijn reis' }).waitFor();
    await controleer(gast.pagina, 'uitnodiging');
    await gast.pagina.getByRole('button', { name: 'Open mijn reis' }).click();
    await gast.pagina.locator('.dag').waitFor();
    await controleer(gast.pagina, 'programma (deelnemer)');
    for (const [tab, wacht] of [['Berichten', '.bericht'], ['Info', '.infoblok'], ['Notities', '.notitie']]) {
      await gast.pagina.getByRole('link', { name: new RegExp(tab) }).click();
      await gast.pagina.locator(wacht).first().waitFor();
      await controleer(gast.pagina, tab.toLowerCase());
    }
    await gast.context.setOffline(true);
    await gast.pagina.getByRole('link', { name: /Programma/ }).click();
    await gast.pagina.locator('.status.offline').waitFor();
    await controleer(gast.pagina, 'programma zonder verbinding');
    await gast.context.close();

    const leider = await nieuwToestel({ als: 'leiderB1', opties: metAxe });
    await leider.pagina.goto(reisPad('B1'));
    await leider.pagina.locator('.dag').waitFor();
    await controleer(leider.pagina, 'programma (groepsleider)');
    await leider.pagina.getByRole('button', { name: /^Wijzig Stadswandeling/ }).click();
    await leider.pagina.locator('dialog[open]').waitFor();
    await controleer(leider.pagina, 'venster onderdeel wijzigen');
    await leider.pagina.getByRole('button', { name: 'Sluiten' }).click();
    await leider.pagina.getByRole('link', { name: /Groep/ }).click();
    await leider.pagina.locator('.leden').first().waitFor();
    await controleer(leider.pagina, 'groep');
    await leider.context.close();

    const ernstig = bevindingen.filter((b) => ['serious', 'critical'].includes(b.ernst));
    const overig = bevindingen.filter((b) => !['serious', 'critical'].includes(b.ernst));
    if (overig.length) console.log('    lichte bevindingen:', JSON.stringify(overig));
    assert.deepEqual(ernstig, [], 'ernstige toegankelijkheidsproblemen');
  });
});

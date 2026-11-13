// Rooktest op een ECHTE omgeving (bijvoorbeeld de live-app op Vercel).
//
//   node e2e/live.mjs <adres> <eenmalige beheerderslink van de testorganisatie> [id van een reis van een andere organisatie]
//
// De test werkt alleen binnen de testorganisatie (zie rooktest.json): hij maakt
// daar een reis "Rooktest ..." aan, loopt de app door als beheerder,
// groepsleider en deelnemer (ook zonder verbinding) en verwijdert de reis weer.
// Het derde argument is optioneel: het id van een reis van een ANDERE
// organisatie. De test controleert dan dat de testdeelnemer daar niet bij kan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const [basisArg, beheerderLink, vreemdeReis] = process.argv.slice(2);
if (!basisArg || !beheerderLink) {
  console.error('Gebruik: node e2e/live.mjs <adres> <beheerderslink> [id van een reis van een andere organisatie]');
  process.exit(2);
}
const basis = basisArg.replace(/\/$/, '');
const map = path.dirname(fileURLToPath(import.meta.url));
const afdrukken = path.join(map, 'schermafdrukken');
fs.mkdirSync(afdrukken, { recursive: true });
// Een klein maar echt jpg-plaatje, hetzelfde als in de andere tests.
const fotoBron = fs.readFileSync(path.join(map, '..', 'test', 'hulp.js'), 'utf8').match(/TESTFOTO = Buffer\.from\('([^']+)'/)[1];
const testfoto = { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fotoBron, 'base64') };

const stempel = new Date().toISOString().slice(0, 16).replace('T', ' ');
const reisNaam = `Rooktest ${stempel}`;
const dagIso = (verschuiving = 0) => {
  const d = new Date(Date.now() + verschuiving * 86400000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(d);
};
const vandaag = dagIso(0);
// Het moment waarop het in Nederland 12:00 is op die dag (zomer- of wintertijd).
function middagInAmsterdam(iso) {
  const uur = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
  return [10, 11].map((u) => new Date(`${iso}T${u}:00:00Z`)).find((d) => uur.format(d).startsWith('12'));
}

let stap = 0;
const gelukt = [];
async function doe(naam, werk) {
  stap += 1;
  const start = Date.now();
  await werk();
  gelukt.push(naam);
  console.log(`ok ${String(stap).padStart(2)}  ${naam}  (${((Date.now() - start) / 1000).toFixed(1)} s)`);
}
const wachtOpFoto = async (locator) => {
  await locator.waitFor();
  return locator.evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((klaar) => {
    img.onload = () => klaar(img.naturalWidth > 0);
    img.onerror = () => klaar(false);
  })));
};
const wachtOpOfflineKlaar = (pagina) => pagina.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((klaar) => navigator.serviceWorker.addEventListener('controllerchange', klaar, { once: true }));
  }
});
const opslagTekst = (pagina) => pagina.evaluate(() => new Promise((klaar) => {
  const verzoek = indexedDB.open('mee-op-reis');
  verzoek.onsuccess = () => {
    const db = verzoek.result;
    if (!db.objectStoreNames.contains('kv')) return klaar('');
    const alles = db.transaction('kv').objectStore('kv').getAll();
    alles.onsuccess = () => klaar(JSON.stringify(alles.result));
  };
  verzoek.onerror = () => klaar('');
}));

const browser = await chromium.launch();
const paginas = [];
async function toestel(opties, tijd) {
  const context = await browser.newContext({ locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', ...opties });
  const pagina = await context.newPage();
  pagina.setDefaultTimeout(45000);
  const fouten = [];
  pagina.on('pageerror', (e) => fouten.push(e.message));
  pagina.on('dialog', (d) => d.accept());
  if (tijd) await pagina.clock.install({ time: tijd });
  paginas.push(pagina);
  return { context, pagina, fouten };
}
const breed = { viewport: { width: 1100, height: 900 } };
const telefoon = devices['Pixel 7'];
// Vanuit de pagina de eigen API aanroepen, met de sessie van die pagina.
const viaApi = (pagina, methode, pad, body) => pagina.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}, [methode, pad, body]);

let beheerder;
let reisId;
try {
  await doe('server, database en beveiligingskoppen', async () => {
    const gezond = await (await fetch(`${basis}/api/gezondheid`)).json();
    assert.equal(gezond.ok, true, JSON.stringify(gezond));
    assert.equal(gezond.database, 'ok');
    const start = await fetch(`${basis}/`);
    assert.equal(start.status, 200);
    assert.match(start.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(start.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(start.headers.get('referrer-policy'), 'no-referrer');
    const diep = await fetch(`${basis}/reis/00000000-0000-4000-8000-000000000000/programma`);
    assert.equal(diep.status, 200, 'een schermadres opent de app');
    assert.match(await diep.text(), /<title>Mee op Reis<\/title>/);
    assert.equal((await fetch(`${basis}/bestaat-niet.png`)).status, 404);
    const ik = await fetch(`${basis}/api/ik`);
    assert.equal(ik.status, 401);
    assert.match(ik.headers.get('cache-control') || '', /no-store/);
    const manifest = await fetch(`${basis}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).display, 'standalone');
    for (const bestand of ['/sw.js', '/fonts/fraunces.woff2', '/omslag/fjorden.jpg', '/icons/icon-512.png']) {
      assert.equal((await fetch(basis + bestand)).status, 200, bestand);
    }
    const vreemd = await fetch(`${basis}/api/uitloggen`, { method: 'POST', headers: { origin: 'https://kwaad.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(vreemd.status, 403, 'aanvraag vanaf een andere website wordt geweigerd');
  });

  beheerder = await toestel(breed);
  await doe('beheerder van de testorganisatie logt in met de eenmalige link', async () => {
    await beheerder.pagina.goto(beheerderLink);
    await beheerder.pagina.getByRole('button', { name: 'Ga verder' }).click();
    await beheerder.pagina.getByRole('heading', { name: 'Mijn reizen' }).waitFor();
    // Resten van een eerder afgebroken test opruimen.
    const ik = await viaApi(beheerder.pagina, 'GET', '/api/ik');
    for (const r of ik.data.reizen.filter((x) => x.titel.startsWith('Rooktest'))) {
      await viaApi(beheerder.pagina, 'PUT', `/api/reizen/${r.id}`, { titel: r.titel, start_datum: r.start_datum, eind_datum: r.eind_datum, gearchiveerd: true });
      await viaApi(beheerder.pagina, 'DELETE', `/api/reizen/${r.id}`);
    }
    assert.ok(ik.data.organisaties.every((o) => /Proeftuin/.test(o.naam)), 'de testbeheerder zit alleen in de testorganisatie');
  });

  let leiderLink;
  await doe('beheerder maakt een reis aan en wijst een groepsleider aan', async () => {
    const { pagina } = beheerder;
    await pagina.reload();
    await pagina.getByRole('button', { name: /Nieuwe reis voor/ }).click();
    await pagina.getByLabel('Naam van de reis').fill(reisNaam);
    await pagina.getByLabel('Eerste dag').fill(vandaag);
    await pagina.getByLabel('Laatste dag').fill(dagIso(2));
    await pagina.getByRole('radio', { name: 'Fjorden' }).check();
    await pagina.getByRole('button', { name: 'Bewaar' }).click();
    await pagina.getByRole('heading', { name: 'Groep', exact: true }).waitFor();
    reisId = pagina.url().split('/reis/')[1].split('/')[0];
    await pagina.getByRole('button', { name: 'Personen uitnodigen' }).click();
    await pagina.getByLabel('Naam en e-mailadres').fill('Proef Leider, delivered+leider@resend.dev');
    await pagina.getByRole('radio', { name: /Groepsleider/ }).check();
    await pagina.getByRole('button', { name: 'Nodig uit' }).click();
    leiderLink = await pagina.locator('.linklijst code').innerText();
    assert.ok(leiderLink.startsWith(`${basis}/u/`), `uitnodigingslink wijst naar het live-adres: ${leiderLink.slice(0, 60)}`);
    await pagina.getByRole('button', { name: 'Klaar' }).click();
  });

  const leider = await toestel(telefoon);
  let deelnemerLink;
  await doe('groepsleider vult het programma, voegt een foto toe en nodigt een deelnemer uit', async () => {
    const { pagina } = leider;
    await pagina.goto(leiderLink);
    await pagina.getByRole('button', { name: 'Open mijn reis' }).click();
    await pagina.locator('.dag').waitFor();
    assert.equal(await pagina.locator('.dagknop').count(), 3, 'voor elke reisdag staat een dag klaar');
    await pagina.getByRole('button', { name: 'Onderdeel toevoegen' }).click();
    await pagina.getByLabel('Wat').fill('Verzamelen voor de rooktest');
    await pagina.getByLabel('Begintijd').fill('14:00');
    await pagina.getByLabel('Aanwezig om').fill('13:45');
    await pagina.getByLabel('Verzamelpunt').fill('Bij de loopplank, gids met rode paraplu');
    await pagina.locator('dialog[open] input[type="file"]').setInputFiles(testfoto);
    await pagina.locator('dialog[open] .foto-voorbeeld').waitFor();
    await pagina.getByRole('button', { name: 'Bewaar' }).click();
    assert.equal(await wachtOpFoto(pagina.locator('.onderdeel img.foto')), true, 'de foto bij het onderdeel is zichtbaar');

    await pagina.getByRole('link', { name: /Berichten/ }).click();
    await pagina.getByLabel('Nieuw bericht aan de groep').fill('Rooktest: de bus vertrekt een kwartier eerder.');
    await pagina.getByLabel(/Belangrijk/).check();
    await pagina.getByRole('button', { name: 'Plaats bericht' }).click();
    await pagina.getByText('Je bericht is geplaatst.').waitFor();

    await pagina.getByRole('link', { name: /Info/ }).click();
    await pagina.getByRole('button', { name: 'Informatie toevoegen' }).click();
    await pagina.getByLabel('Onderwerp').fill('Noodnummer');
    await pagina.getByLabel('Tekst').fill('Bel de reisleiding op 06 00000000');
    await pagina.getByRole('button', { name: 'Bewaar' }).click();
    await pagina.locator('.infoblok a[href^="tel:"]').waitFor();

    await pagina.getByRole('link', { name: /Groep/ }).click();
    await pagina.getByRole('button', { name: 'Personen uitnodigen' }).click();
    await pagina.getByLabel('Naam en e-mailadres').fill('Proef Deelnemer, delivered+deelnemer@resend.dev');
    assert.equal(await pagina.getByRole('radio', { name: /Groepsleider/ }).count(), 0, 'een groepsleider kan geen groepsleiders aanwijzen');
    await pagina.getByRole('button', { name: 'Nodig uit' }).click();
    deelnemerLink = await pagina.locator('.linklijst code').innerText();
  });

  // Voor de deelnemer is het vandaag 12:00: dan is het onderdeel van 13:45 het eerstvolgende.
  const deelnemer = await toestel(telefoon, middagInAmsterdam(vandaag));
  await doe('deelnemer opent de uitnodiging en ziet waar en hoe laat, met foto', async () => {
    const { pagina } = deelnemer;
    await pagina.goto(deelnemerLink);
    await pagina.getByRole('heading', { name: 'Welkom, Proef Deelnemer' }).waitFor();
    await pagina.screenshot({ path: path.join(afdrukken, 'live-uitnodiging.png') });
    await pagina.getByRole('button', { name: 'Open mijn reis' }).click();
    const eerst = pagina.getByRole('region', { name: 'Eerstvolgende' });
    await eerst.waitFor();
    assert.match(await eerst.innerText(), /Aanwezig om 13:45[\s\S]*Verzamelen voor de rooktest[\s\S]*Bij de loopplank/);
    assert.equal(await wachtOpFoto(pagina.locator('.onderdeel img.foto')), true, 'foto van het verzamelpunt');
    assert.match(await pagina.locator('.belangrijk-balk').innerText(), /bus vertrekt een kwartier eerder/);
    assert.equal(await pagina.getByRole('link', { name: 'Groep' }).count(), 0, 'geen beheer voor een deelnemer');
    assert.equal(await wachtOpFoto(pagina.locator('.kop img')), true, 'sfeerbeeld in de kop');
    await pagina.screenshot({ path: path.join(afdrukken, 'live-programma.png') });
  });

  await doe('de app is installeerbaar volgens Chrome', async () => {
    await wachtOpOfflineKlaar(deelnemer.pagina);
    const cdp = await deelnemer.context.newCDPSession(deelnemer.pagina);
    assert.deepEqual((await cdp.send('Page.getAppManifest')).errors, []);
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  });

  await doe('zonder verbinding: programma, foto, info, berichten en notities blijven werken', async () => {
    const { pagina, context } = deelnemer;
    // Geef de app even om de foto's op het toestel te zetten.
    await pagina.waitForFunction(async () => (await caches.open('mee-op-reis-fotos').then((c) => c.keys())).length > 0);
    await context.setOffline(true);
    await pagina.reload();
    await pagina.getByRole('region', { name: 'Eerstvolgende' }).waitFor();
    assert.match(await pagina.locator('.status.offline').innerText(), /Geen verbinding[\s\S]*opgehaald vandaag om 12:0\d/);
    assert.match(await pagina.locator('.onderdeel').innerText(), /14:00[\s\S]*Aanwezig om 13:45[\s\S]*Bij de loopplank/);
    assert.equal(await wachtOpFoto(pagina.locator('.onderdeel img.foto')), true, 'foto ook offline');
    assert.equal(await wachtOpFoto(pagina.locator('.kop img')), true, 'sfeerbeeld ook offline');
    await pagina.screenshot({ path: path.join(afdrukken, 'live-offline.png') });
    await pagina.getByRole('link', { name: /Info/ }).click();
    await pagina.getByText('Bel de reisleiding op').waitFor();
    await pagina.getByRole('link', { name: /Berichten/ }).click();
    await pagina.getByText('Rooktest: de bus vertrekt een kwartier eerder.').waitFor();
    await pagina.getByRole('link', { name: /Notities/ }).click();
    await pagina.getByLabel('Mijn notities').fill('Hut 4012');
    await pagina.getByText(/Bewaard op dit toestel/).waitFor();
    await pagina.reload();
    await pagina.getByRole('link', { name: /Notities/ }).click();
    assert.equal(await pagina.getByLabel('Mijn notities').inputValue(), 'Hut 4012');
    await context.setOffline(false);
  });

  await doe('groepsleider wijzigt de tijd; de deelnemer ziet dat het programma gewijzigd is', async () => {
    await leider.pagina.getByRole('link', { name: /Programma/ }).click();
    await leider.pagina.getByRole('button', { name: 'Wijzig Verzamelen voor de rooktest' }).click();
    await leider.pagina.getByLabel('Aanwezig om').fill('13:30');
    await leider.pagina.getByRole('button', { name: 'Bewaar' }).click();
    await leider.pagina.getByText('Aanwezig om 13:30').first().waitFor();
    await deelnemer.pagina.goto(`${basis}/reis/${reisId}/programma`);
    const balk = deelnemer.pagina.getByRole('region', { name: 'Wijzigingen in het programma' });
    await balk.waitFor();
    assert.match(await deelnemer.pagina.getByRole('region', { name: 'Eerstvolgende' }).innerText(), /Aanwezig om 13:30/);
    assert.match(await deelnemer.pagina.locator('.onderdeel.gemarkeerd').innerText(), /Gewijzigd/);
  });

  await doe('de deelnemer komt niet bij andere reizen of bij het beheer', async () => {
    const { pagina } = deelnemer;
    const eigen = await viaApi(pagina, 'GET', `/api/reizen/${reisId}/leden`);
    assert.equal(eigen.status, 403, 'deelnemerslijst is niet voor deelnemers');
    assert.equal((await viaApi(pagina, 'POST', `/api/reizen/${reisId}/berichten`, { tekst: 'x' })).status, 403);
    if (vreemdeReis) {
      const ander = await viaApi(pagina, 'GET', `/api/reizen/${vreemdeReis}/bundel`);
      assert.equal(ander.status, 404, 'reis van een andere organisatie is onzichtbaar');
      assert.equal((await viaApi(pagina, 'GET', `/api/reizen/${vreemdeReis}/leden`)).status, 404);
      await pagina.goto(`${basis}/reis/${vreemdeReis}/programma`);
      await pagina.getByRole('heading', { name: 'Geen toegang' }).waitFor();
      const ik = await viaApi(pagina, 'GET', '/api/ik');
      assert.deepEqual(ik.data.reizen.map((r) => r.id), [reisId], 'alleen de eigen reis in het overzicht');
      assert.ok(ik.data.organisaties.every((o) => /Proeftuin/.test(o.naam)));
    }
  });

  await doe('toegang intrekken werkt direct en wist het toestel van de deelnemer', async () => {
    await leider.pagina.getByRole('link', { name: /Groep/ }).click();
    await leider.pagina.getByRole('button', { name: 'Toegang intrekken van Proef Deelnemer' }).click();
    await leider.pagina.locator('.lid', { hasText: 'Proef Deelnemer' }).getByText('Toegang ingetrokken').waitFor();
    await deelnemer.pagina.goto(`${basis}/reis/${reisId}/programma`);
    await deelnemer.pagina.getByRole('heading', { name: 'Geen toegang' }).waitFor();
    assert.ok(!(await opslagTekst(deelnemer.pagina)).includes('Verzamelen voor de rooktest'), 'programma is van het toestel verwijderd');
    assert.equal(await deelnemer.pagina.evaluate(() => caches.has('mee-op-reis-fotos')), false, "foto's zijn van het toestel verwijderd");
  });

  await doe('uitloggen wist het toestel van de groepsleider', async () => {
    await leider.pagina.getByRole('link', { name: /Info/ }).click();
    await leider.pagina.getByRole('button', { name: 'Uitloggen' }).click();
    await leider.pagina.getByRole('heading', { name: 'Inloggen' }).waitFor();
    assert.equal(await opslagTekst(leider.pagina), '[]');
    assert.equal((await viaApi(leider.pagina, 'GET', '/api/ik')).status, 401);
  });

  await doe('beheerder sluit de reis af en verwijdert hem definitief', async () => {
    const { pagina } = beheerder;
    await pagina.goto(`${basis}/reis/${reisId}/beheer`);
    await pagina.getByRole('button', { name: 'Reisgegevens wijzigen' }).click();
    await pagina.getByLabel(/Reis afsluiten/).check();
    await pagina.getByRole('button', { name: 'Bewaar' }).click();
    await pagina.locator('dialog[open]').waitFor({ state: 'detached' });
    await pagina.getByRole('button', { name: 'Reisgegevens wijzigen' }).click();
    await pagina.getByRole('button', { name: 'Reis definitief verwijderen' }).click();
    await pagina.getByRole('heading', { name: 'Mijn reizen' }).waitFor();
    const ik = await viaApi(pagina, 'GET', '/api/ik');
    assert.ok(!ik.data.reizen.some((r) => r.id === reisId), 'de testreis is weg');
    reisId = null;
  });

  await doe('geen scriptfouten in de browser', async () => {
    assert.deepEqual([...beheerder.fouten, ...leider.fouten, ...deelnemer.fouten], []);
  });

  console.log(`\nGeslaagd: ${gelukt.length} van ${gelukt.length} stappen op ${basis}`);
} catch (fout) {
  console.error(`\nGEZAKT bij stap ${stap}: ${fout.message}`);
  for (const [i, pagina] of paginas.entries()) {
    await pagina.screenshot({ path: path.join(afdrukken, `live-fout-${i}.png`) }).catch(() => {});
  }
  // De testreis niet laten slingeren.
  if (reisId && beheerder) {
    await viaApi(beheerder.pagina, 'PUT', `/api/reizen/${reisId}`, { titel: reisNaam, start_datum: vandaag, eind_datum: dagIso(2), gearchiveerd: true }).catch(() => {});
    await viaApi(beheerder.pagina, 'DELETE', `/api/reizen/${reisId}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}

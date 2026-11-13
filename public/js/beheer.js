// Alles wat alleen groepsleiders en beheerders zien: programma en informatie
// bewerken, berichten plaatsen en de groep beheren. De server controleert elke
// wijziging opnieuw; wat hier verborgen is, is daar ook echt verboden.
import { html, useEffect, useState } from './vendor/preact-htm.js';
import { api, GeenVerbinding } from './api.js';
import { datumLang } from './hulp.js';
import { FotoKiezer, Melding, Sfeerbeeld, Veld, Venster, Vinkje, useActie } from './onderdelen.js';

function Knoppen({ bezig, onVerwijder, verwijderLabel = 'Verwijder', bewaarLabel = 'Bewaar' }) {
  return html`
    <div class="vensterknoppen">
      <button class="knop" type="submit" disabled=${bezig}>${bezig ? 'Bezig…' : bewaarLabel}</button>
      ${onVerwijder && html`<button class="knop gevaar" type="button" disabled=${bezig} onClick=${onVerwijder}>${verwijderLabel}</button>`}
    </div>`;
}

export function OnderdeelVenster({ reis, dag, onderdeel, onKlaar, onSluit }) {
  const [v, setV] = useState(() => ({
    begin_tijd: '', eind_tijd: '', titel: '', omschrijving: '', verzameltijd: '', verzamelpunt: '', meenemen: '', facultatief: false, afbeelding_id: null,
    ...(onderdeel || {}),
  }));
  const zet = (veld) => (waarde) => setV((oud) => ({ ...oud, [veld]: waarde }));
  const { bezig, fout, voerUit } = useActie();

  async function bewaar(e) {
    e.preventDefault();
    const gelukt = await voerUit(() => (onderdeel
      ? api('PUT', `/api/onderdelen/${onderdeel.id}`, v)
      : api('POST', `/api/dagen/${dag.id}/onderdelen`, v)));
    if (gelukt) onKlaar();
  }
  async function verwijder() {
    if (!window.confirm(`"${onderdeel.titel}" uit het programma halen? Deelnemers zien dan dat dit onderdeel vervallen is.`)) return;
    if (await voerUit(() => api('DELETE', `/api/onderdelen/${onderdeel.id}`))) onKlaar();
  }

  return html`
    <${Venster} titel=${onderdeel ? 'Onderdeel wijzigen' : 'Onderdeel toevoegen'} onSluit=${onSluit}>
      <form onSubmit=${bewaar}>
        <p class="uitleg">${datumLang(dag.datum)}${dag.titel ? `, ${dag.titel}` : ''}</p>
        <${Veld} label="Wat" waarde=${v.titel} zet=${zet('titel')} verplicht maxlength="160" />
        <div class="naast-elkaar">
          <${Veld} label="Begintijd" soort="time" waarde=${v.begin_tijd} zet=${zet('begin_tijd')} />
          <${Veld} label="Eindtijd" soort="time" waarde=${v.eind_tijd} zet=${zet('eind_tijd')} />
        </div>
        <${Veld} label="Aanwezig om" soort="time" waarde=${v.verzameltijd} zet=${zet('verzameltijd')}
          uitleg="Het tijdstip waarop iedereen bij het verzamelpunt moet staan." />
        <${Veld} label="Verzamelpunt" soort="textarea" rijen="2" waarde=${v.verzamelpunt} zet=${zet('verzamelpunt')} maxlength="500"
          uitleg="Zo precies mogelijk, met een herkenningspunt. Bijvoorbeeld: bij de loopplank, de gids draagt een oranje jas." />
        <${FotoKiezer} reisId=${reis.id} waarde=${v.afbeelding_id} zet=${zet('afbeelding_id')} label="Foto, bijvoorbeeld van het verzamelpunt" />
        <${Veld} label="Omschrijving" soort="textarea" waarde=${v.omschrijving} zet=${zet('omschrijving')} maxlength="4000" />
        <${Veld} label="Meenemen" waarde=${v.meenemen} zet=${zet('meenemen')} maxlength="500" />
        <${Vinkje} label="Alleen voor wie zich heeft opgegeven (facultatief)" waarde=${v.facultatief} zet=${zet('facultatief')} />
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} onVerwijder=${onderdeel ? verwijder : null} verwijderLabel="Haal uit programma" />
      </form>
    <//>`;
}

export function DagVenster({ reis, dag, onKlaar, onSluit }) {
  const [v, setV] = useState(() => ({ datum: '', titel: '', ondertitel: '', toelichting: '', afbeelding_id: null, ...(dag || {}) }));
  const zet = (veld) => (waarde) => setV((oud) => ({ ...oud, [veld]: waarde }));
  const { bezig, fout, voerUit } = useActie();

  async function bewaar(e) {
    e.preventDefault();
    const gelukt = await voerUit(() => (dag ? api('PUT', `/api/dagen/${dag.id}`, v) : api('POST', `/api/reizen/${reis.id}/dagen`, v)));
    if (gelukt) onKlaar();
  }
  async function verwijder() {
    if (!window.confirm(`${datumLang(dag.datum)} met alle onderdelen uit het programma halen?`)) return;
    if (await voerUit(() => api('DELETE', `/api/dagen/${dag.id}`))) onKlaar();
  }

  return html`
    <${Venster} titel=${dag ? 'Dag wijzigen' : 'Dag toevoegen'} onSluit=${onSluit}>
      <form onSubmit=${bewaar}>
        ${dag
          ? html`<p class="uitleg">${datumLang(dag.datum)}</p>`
          : html`<${Veld} label="Datum" soort="date" waarde=${v.datum} zet=${zet('datum')} verplicht />`}
        <${Veld} label="Titel" waarde=${v.titel} zet=${zet('titel')} maxlength="120" uitleg="Bijvoorbeeld de plaats of haven van deze dag." />
        <${Veld} label="Ondertitel" waarde=${v.ondertitel} zet=${zet('ondertitel')} maxlength="200"
          uitleg="Bijvoorbeeld: in de haven van 08:00 tot 16:00." />
        <${Veld} label="Toelichting" soort="textarea" waarde=${v.toelichting} zet=${zet('toelichting')} maxlength="4000" />
        <${FotoKiezer} reisId=${reis.id} waarde=${v.afbeelding_id} zet=${zet('afbeelding_id')} label="Foto bij deze dag" />
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} onVerwijder=${dag ? verwijder : null} verwijderLabel="Verwijder dag" />
      </form>
    <//>`;
}

export function InfoVenster({ reis, blok, onKlaar, onSluit }) {
  const [v, setV] = useState(() => ({ titel: '', tekst: '', volgorde: 0, ...(blok || {}) }));
  const zet = (veld) => (waarde) => setV((oud) => ({ ...oud, [veld]: waarde }));
  const { bezig, fout, voerUit } = useActie();

  async function bewaar(e) {
    e.preventDefault();
    const body = { ...v, volgorde: Number.parseInt(v.volgorde, 10) || 0 };
    const gelukt = await voerUit(() => (blok ? api('PUT', `/api/info/${blok.id}`, body) : api('POST', `/api/reizen/${reis.id}/info`, body)));
    if (gelukt) onKlaar();
  }
  async function verwijder() {
    if (!window.confirm(`"${blok.titel}" verwijderen?`)) return;
    if (await voerUit(() => api('DELETE', `/api/info/${blok.id}`))) onKlaar();
  }

  return html`
    <${Venster} titel=${blok ? 'Informatie wijzigen' : 'Informatie toevoegen'} onSluit=${onSluit}>
      <form onSubmit=${bewaar}>
        <${Veld} label="Onderwerp" waarde=${v.titel} zet=${zet('titel')} verplicht maxlength="160" />
        <${Veld} label="Tekst" soort="textarea" rijen="8" waarde=${v.tekst} zet=${zet('tekst')} maxlength="8000"
          uitleg="Telefoonnummers, e-mailadressen en webadressen worden vanzelf aanklikbaar." />
        <${Veld} label="Volgorde" soort="number" waarde=${v.volgorde} zet=${zet('volgorde')}
          uitleg="Lagere nummers staan bovenaan. Zet het noodnummer bijvoorbeeld op 1." />
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} onVerwijder=${blok ? verwijder : null} />
      </form>
    <//>`;
}

export function BerichtFormulier({ reis, onKlaar }) {
  const [tekst, setTekst] = useState('');
  const [belangrijk, setBelangrijk] = useState(false);
  const [foto, setFoto] = useState(null);
  const [geplaatst, setGeplaatst] = useState(false);
  const { bezig, fout, voerUit } = useActie();

  async function plaats(e) {
    e.preventDefault();
    setGeplaatst(false);
    if (await voerUit(() => api('POST', `/api/reizen/${reis.id}/berichten`, { tekst, belangrijk, afbeelding_id: foto }))) {
      setTekst('');
      setBelangrijk(false);
      setFoto(null);
      setGeplaatst(true);
      onKlaar();
    }
  }
  return html`
    <form class="berichtformulier" onSubmit=${plaats}>
      <${Veld} label="Nieuw bericht aan de groep" soort="textarea" rijen="3" waarde=${tekst} zet=${setTekst} verplicht maxlength="4000" />
      <${FotoKiezer} reisId=${reis.id} waarde=${foto} zet=${setFoto} label="Foto bij dit bericht" />
      <${Vinkje} label="Belangrijk: toon dit bericht ook boven het programma" waarde=${belangrijk} zet=${setBelangrijk} />
      <${Melding}>${fout}<//>
      <${Melding} soort="goed">${geplaatst && 'Je bericht is geplaatst.'}<//>
      <button class="knop" type="submit" disabled=${bezig}>${bezig ? 'Bezig…' : 'Plaats bericht'}</button>
    </form>`;
}

const OMSLAGEN = [['zee', 'Op zee'], ['fjorden', 'Fjorden'], ['rivier', 'Rivier'], ['stad', 'Stad'], ['landschap', 'Landschap']];

export function ReisVenster({ orgId, reis, onKlaar, onSluit, onVerwijderd }) {
  const [v, setV] = useState(() => ({ titel: '', ondertitel: '', start_datum: '', eind_datum: '', gearchiveerd: false, omslag: 'zee', omslag_afbeelding_id: null, ...(reis || {}) }));
  const zet = (veld) => (waarde) => setV((oud) => ({ ...oud, [veld]: waarde }));
  const { bezig, fout, voerUit } = useActie();

  async function bewaar(e) {
    e.preventDefault();
    const antwoord = await voerUit(() => (reis ? api('PUT', `/api/reizen/${reis.id}`, v) : api('POST', `/api/organisaties/${orgId}/reizen`, v)));
    if (antwoord) onKlaar(antwoord.data);
  }
  async function verwijder() {
    if (!window.confirm(`"${reis.titel}" definitief verwijderen? Het programma, de berichten, de foto's en de deelnemerslijst van deze reis worden gewist. Dit kan niet ongedaan worden gemaakt.`)) return;
    if (await voerUit(() => api('DELETE', `/api/reizen/${reis.id}`))) onVerwijderd?.();
  }
  return html`
    <${Venster} titel=${reis ? 'Reisgegevens wijzigen' : 'Nieuwe reis'} onSluit=${onSluit}>
      <form onSubmit=${bewaar}>
        <${Veld} label="Naam van de reis" waarde=${v.titel} zet=${zet('titel')} verplicht maxlength="120" />
        <${Veld} label="Ondertitel" waarde=${v.ondertitel} zet=${zet('ondertitel')} maxlength="200" />
        <div class="naast-elkaar">
          <${Veld} label="Eerste dag" soort="date" waarde=${v.start_datum} zet=${zet('start_datum')} verplicht />
          <${Veld} label="Laatste dag" soort="date" waarde=${v.eind_datum} zet=${zet('eind_datum')} verplicht />
        </div>
        <fieldset class="keuze">
          <legend>Sfeerbeeld</legend>
          <div class="beeldkeuze">
            ${OMSLAGEN.map(([sleutel, naam]) => html`
              <label>
                <input type="radio" name="omslag" checked=${v.omslag === sleutel} onChange=${() => zet('omslag')(sleutel)} />
                <span class="beeldvlak"><${Sfeerbeeld} naam=${sleutel} lui /><span>${naam}</span></span>
              </label>`)}
          </div>
        </fieldset>
        ${reis && html`<${FotoKiezer} reisId=${reis.id} waarde=${v.omslag_afbeelding_id} zet=${zet('omslag_afbeelding_id')}
            label="Of een eigen foto als omslag (gaat voor het sfeerbeeld)" />`}
        ${!reis && html`<p class="uitleg">Voor elke dag van de reis wordt alvast een lege dag in het programma gezet. Een eigen omslagfoto kun je daarna toevoegen via Reisgegevens wijzigen.</p>`}
        ${reis && html`<${Vinkje} label="Reis afsluiten: deelnemers en groepsleiders kunnen de reis niet meer openen" waarde=${v.gearchiveerd} zet=${zet('gearchiveerd')} />`}
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} onVerwijder=${reis?.gearchiveerd ? verwijder : null} verwijderLabel="Reis definitief verwijderen" />
        ${reis && !reis.gearchiveerd && html`<p class="uitleg">Een reis verwijderen kan nadat je hem hebt afgesloten.</p>`}
      </form>
    <//>`;
}

// ---------------------------------------------------------------------------
// De groep: uitnodigen, nieuwe link, toegang intrekken, exporteren
// ---------------------------------------------------------------------------

const STATUS = { actief: 'Heeft de app geopend', uitgenodigd: 'Uitgenodigd, nog niet geopend', verlopen: 'Link verlopen', ingetrokken: 'Toegang ingetrokken' };

// Eén persoon per regel, in elke gangbare vorm: "Jan Jansen, jan@voorbeeld.nl",
// "Jan Jansen <jan@voorbeeld.nl>", of geplakt uit Excel met een tab ertussen.
export function leesPersonen(tekst) {
  const personen = [];
  const fouten = [];
  tekst.split(/\r?\n/).forEach((regel, i) => {
    if (!regel.trim()) return;
    const email = regel.match(/[^\s<>;,"]+@[^\s<>;,"]+\.[^\s<>;,"]+/)?.[0];
    if (!email) {
      fouten.push(`Regel ${i + 1}: geen e-mailadres gevonden.`);
      return;
    }
    const naam = regel.replace(email, ' ').replace(/[<>;,"\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    personen.push({ naam: naam || email.split('@')[0], email: email.toLowerCase() });
  });
  return { personen, fouten };
}

async function kopieer(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    return true;
  } catch {
    return false;
  }
}

function NaamVenster({ lid, onKlaar, onSluit }) {
  const [naam, setNaam] = useState(lid.naam);
  const { bezig, fout, voerUit } = useActie();
  async function bewaar(e) {
    e.preventDefault();
    if (await voerUit(() => api('PUT', `/api/leden/${lid.id}`, { naam }))) onKlaar();
  }
  return html`
    <${Venster} titel="Naam wijzigen" onSluit=${onSluit}>
      <form onSubmit=${bewaar}>
        <p class="uitleg">${lid.email}</p>
        <${Veld} label="Naam" waarde=${naam} zet=${setNaam} verplicht maxlength="120"
          uitleg="Zo zien deelnemers deze persoon, bijvoorbeeld als afzender van een bericht. Eerder geplaatste berichten houden de oude naam." />
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} />
      </form>
    <//>`;
}

function Toevoegen({ reis, magLeiders, onKlaar, onSluit }) {
  const [tekst, setTekst] = useState('');
  const [rol, setRol] = useState('deelnemer');
  const { bezig, fout, setFout, voerUit } = useActie();

  async function verstuur(e) {
    e.preventDefault();
    const { personen, fouten } = leesPersonen(tekst);
    if (fouten.length) return setFout(fouten.join(' '));
    if (!personen.length) return setFout('Vul minstens één persoon in.');
    const antwoord = await voerUit(() => api('POST', `/api/reizen/${reis.id}/leden`, { leden: personen.map((p) => ({ ...p, rol })) }));
    if (antwoord) onKlaar(antwoord.data.resultaat);
  }
  return html`
    <${Venster} titel="Personen uitnodigen" onSluit=${onSluit}>
      <form onSubmit=${verstuur}>
        <${Veld} label="Naam en e-mailadres, één persoon per regel" soort="textarea" rijen="7" waarde=${tekst} zet=${setTekst} verplicht
          placeholder=${'Jan Jansen, jan@voorbeeld.nl\nRia de Boer, ria@voorbeeld.nl'}
          uitleg="Plakken uit Excel of je mailprogramma werkt ook. Iedereen krijgt een eigen, eenmalige link." />
        ${magLeiders && html`
          <fieldset class="keuze">
            <legend>Uitnodigen als</legend>
            <label><input type="radio" name="rol" checked=${rol === 'deelnemer'} onChange=${() => setRol('deelnemer')} /> Deelnemer</label>
            <label><input type="radio" name="rol" checked=${rol === 'groepsleider'} onChange=${() => setRol('groepsleider')} /> Groepsleider (mag programma, informatie, berichten en deelnemers beheren)</label>
          </fieldset>`}
        <${Melding}>${fout}<//>
        <${Knoppen} bezig=${bezig} bewaarLabel="Nodig uit" />
      </form>
    <//>`;
}

function Links({ resultaat, mailActief, onSluit }) {
  const nieuw = resultaat.filter((r) => r.link);
  const dubbel = resultaat.filter((r) => r.status === 'bestond_al');
  const [gekopieerd, setGekopieerd] = useState('');
  const kan = (r) => async () => setGekopieerd((await kopieer(r.link)) ? r.email : 'mislukt');
  const allemaal = async () => setGekopieerd((await kopieer(nieuw.map((r) => `${r.naam}: ${r.link}`).join('\n'))) ? 'alle' : 'mislukt');
  return html`
    <section class="linkresultaat" aria-label="Uitnodigingslinks">
      <h3>${nieuw.length === 1 ? 'Uitnodiging gemaakt' : `${nieuw.length} uitnodigingen gemaakt`}</h3>
      <p>${nieuw.some((r) => r.gemaild)
        ? 'De uitnodigingen zijn per e-mail verstuurd. Je kunt een link hieronder ook zelf doorsturen, bijvoorbeeld via WhatsApp.'
        : mailActief
          ? 'Het versturen per e-mail is niet gelukt. Stuur de links hieronder zelf door.'
          : 'Stuur elke persoon de eigen link, bijvoorbeeld via WhatsApp of e-mail.'}
        ${' '}Deze links zijn alleen nu zichtbaar. Kwijt? Maak dan een nieuwe link.</p>
      ${dubbel.length > 0 && html`<${Melding} soort="let-op">Al in de groep, dus overgeslagen: ${dubbel.map((d) => d.email).join(', ')}.<//>`}
      <ul class="linklijst">
        ${nieuw.map((r) => html`
          <li>
            <span class="lid-naam">${r.naam}</span>
            <code class="link">${r.link}</code>
            <button class="knop klein tweede" onClick=${kan(r)}>${gekopieerd === r.email ? 'Gekopieerd' : 'Kopieer link'}</button>
            ${navigator.share && html`<button class="knop klein tweede" onClick=${() => navigator.share({ text: `Je persoonlijke link voor de reis-app: ${r.link}` }).catch(() => {})}>Deel</button>`}
          </li>`)}
      </ul>
      ${gekopieerd === 'mislukt' && html`<${Melding}>Kopiëren lukt niet op dit toestel. Selecteer de link en kopieer hem met de hand.<//>`}
      <div class="vensterknoppen">
        ${nieuw.length > 1 && html`<button class="knop tweede" onClick=${allemaal}>${gekopieerd === 'alle' ? 'Gekopieerd' : 'Kopieer alle links'}</button>`}
        <button class="knop" onClick=${onSluit}>Klaar</button>
      </div>
    </section>`;
}

export function Beheer({ reis, ververs, online, laadIk, ga }) {
  const [gegevens, setGegevens] = useState(null);
  const [venster, setVenster] = useState(null);
  const [resultaat, setResultaat] = useState(null);
  const { bezig, fout, setFout, voerUit } = useActie();

  async function laad() {
    try {
      const antwoord = await api('GET', `/api/reizen/${reis.id}/leden`);
      if (antwoord.ok) {
        setGegevens(antwoord.data);
        setFout('');
      } else setFout(antwoord.fout);
    } catch (e) {
      if (!(e instanceof GeenVerbinding)) throw e;
      setFout('Geen verbinding. De groep beheren kan alleen als je internet hebt.');
    }
  }
  useEffect(() => { laad(); }, [reis.id, online]);

  async function nieuweLink(lid) {
    const waarschuwing = lid.status === 'actief'
      ? `Nieuwe link maken voor ${lid.naam}? De toegang op alle toestellen van ${lid.naam} vervalt; met de nieuwe link kan weer één toestel worden aangemeld. Gebruik dit bijvoorbeeld bij een verloren telefoon.`
      : `Nieuwe link maken voor ${lid.naam}? De vorige link werkt dan niet meer.`;
    if (!window.confirm(waarschuwing)) return;
    const antwoord = await voerUit(() => api('POST', `/api/leden/${lid.id}/nieuwe-link`));
    if (antwoord) {
      setResultaat([{ ...lid, ...antwoord.data }]);
      laad();
    }
  }
  async function trekIn(lid) {
    if (!window.confirm(`Toegang van ${lid.naam} intrekken? ${lid.naam} kan de reis dan direct niet meer openen.`)) return;
    if (await voerUit(() => api('POST', `/api/leden/${lid.id}/intrekken`))) laad();
  }
  async function verwijder(lid) {
    if (!window.confirm(`${lid.naam} uit de lijst verwijderen? De uitnodigingslink werkt dan niet meer.`)) return;
    if (await voerUit(() => api('DELETE', `/api/leden/${lid.id}`))) laad();
  }

  const leden = gegevens?.leden || [];
  const deelnemers = leden.filter((l) => l.rol === 'deelnemer');
  const leiders = leden.filter((l) => l.rol === 'groepsleider');
  const actief = deelnemers.filter((l) => l.status === 'actief').length;
  const magLeiders = gegevens?.mag_groepsleiders_beheren;

  const beheerders = gegevens?.beheerders || [];
  const rij = (lid) => {
    const magDit = lid.rol === 'deelnemer' || magLeiders;
    const isBeheerder = lid.rol === 'beheerder';
    return html`
      <li class="lid">
        <div>
          <p class="lid-naam">${lid.naam}</p>
          <p class="lid-mail">${lid.email}</p>
          <p class=${`lid-status ${lid.status}`}>${STATUS[lid.status]}</p>
        </div>
        ${magDit && html`
          <div class="lid-knoppen">
            <button class="knop klein tweede" disabled=${bezig} onClick=${() => setVenster({ naamVan: lid })} aria-label=${`Wijzig naam van ${lid.naam}`}>Wijzig naam</button>
            ${!isBeheerder && html`<button class="knop klein tweede" disabled=${bezig} onClick=${() => nieuweLink(lid)} aria-label=${`Nieuwe link voor ${lid.naam}`}>Nieuwe link</button>`}
            ${!isBeheerder && lid.status === 'actief' && html`<button class="knop klein gevaar" disabled=${bezig} onClick=${() => trekIn(lid)} aria-label=${`Toegang intrekken van ${lid.naam}`}>Intrekken</button>`}
            ${!isBeheerder && (lid.status === 'uitgenodigd' || lid.status === 'verlopen') && html`<button class="knop klein gevaar" disabled=${bezig} onClick=${() => verwijder(lid)} aria-label=${`Verwijder ${lid.naam}`}>Verwijder</button>`}
          </div>`}
      </li>`;
  };

  return html`
    <h2>Groep</h2>
    <${Melding}>${fout}<//>
    ${resultaat && html`<${Links} resultaat=${resultaat} mailActief=${gegevens?.mail_actief} onSluit=${() => setResultaat(null)} />`}
    ${gegevens && html`
      <p class="samenvatting"><strong>${deelnemers.length}</strong> ${deelnemers.length === 1 ? 'deelnemer' : 'deelnemers'},
        waarvan <strong>${actief}</strong> de app ${actief === 1 ? 'heeft' : 'hebben'} geopend.</p>
      <div class="beheerknoppen">
        <button class="knop" onClick=${() => setVenster('toevoegen')}>Personen uitnodigen</button>
        <a class="knop tweede" href=${`/api/reizen/${reis.id}/deelnemers.csv`} download>Download deelnemerslijst (Excel/csv)</a>
        ${reis.beheerder && html`<button class="knop tweede" onClick=${() => setVenster('reis')}>Reisgegevens wijzigen</button>`}
      </div>

      <h3>Groepsleiders</h3>
      ${leiders.length === 0
        ? html`<p class="leeg">${magLeiders ? 'Nog geen groepsleider aangewezen. Kies Personen uitnodigen en dan Groepsleider.' : 'Nog geen groepsleiders.'}</p>`
        : html`<ul class="leden">${leiders.map(rij)}</ul>`}
      ${!magLeiders && html`<p class="uitleg">Groepsleiders worden aangewezen door de beheerder van ${reis.organisatie}.</p>`}

      <h3>Deelnemers</h3>
      ${deelnemers.length === 0
        ? html`<p class="leeg">Nog geen deelnemers uitgenodigd.</p>`
        : html`<ul class="leden">${deelnemers.map(rij)}</ul>`}

      ${beheerders.length > 0 && html`
        <h3>Beheerders van ${reis.organisatie}</h3>
        <p class="uitleg">Beheerders zien alle reizen van de organisatie. Hun naam staat bij berichten die zij plaatsen.</p>
        <ul class="leden">${beheerders.map(rij)}</ul>`}`}

    ${venster?.naamVan && html`<${NaamVenster} lid=${venster.naamVan} onSluit=${() => setVenster(null)}
        onKlaar=${() => { setVenster(null); laad(); ververs(); laadIk(); }} />`}
    ${venster === 'toevoegen' && html`<${Toevoegen} reis=${reis} magLeiders=${magLeiders} onSluit=${() => setVenster(null)}
        onKlaar=${(r) => { setVenster(null); setResultaat(r); laad(); }} />`}
    ${venster === 'reis' && html`<${ReisVenster} reis=${reis} onSluit=${() => setVenster(null)}
        onKlaar=${() => { setVenster(null); ververs(); laadIk(); }}
        onVerwijderd=${async () => { setVenster(null); await laadIk(); ga('/', { vervang: true }); }} />`}`;
}

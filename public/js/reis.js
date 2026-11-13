// Het reisscherm: programma, berichten, praktische info en notities.
// Alles wordt eerst uit de opslag op het toestel getoond en daarna ververst,
// zodat het programma er ook zonder verbinding direct staat.
import { html, useCallback, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { api, GeenVerbinding } from './api.js';
import { lees, bewaar, wisReis, bewaarFotos } from './opslag.js';
import { isoDatum, klokTijd, datumLang, weekdagKort, dagMaand, moment, metLinks, moetErZijn, verschillen } from './hulp.js';
import { Foto, Icoon, Melding, Sfeerbeeld } from './onderdelen.js';
import { OnderdeelVenster, DagVenster, InfoVenster, BerichtFormulier, Beheer } from './beheer.js';

const VEROUDERD_NA = 12 * 3600 * 1000;
const TABS = [['programma', 'Programma'], ['berichten', 'Berichten'], ['info', 'Info'], ['notities', 'Notities']];

export function ReisScherm({ reisId, tab, ik, ga, laadIk, uitloggen }) {
  const [bundel, setBundel] = useState(null);
  const [opgehaald, setOpgehaald] = useState(null);
  const [verbinding, setVerbinding] = useState('bezig'); // bezig | online | offline
  const [geenToegang, setGeenToegang] = useState(false);
  const [merken, setMerken] = useState({ items: {}, vervallen: [] });
  const [gelezenTot, setGelezenTot] = useState('');
  const [nu, setNu] = useState(() => new Date());

  const ververs = useCallback(async () => {
    try {
      const antwoord = await api('GET', `/api/reizen/${reisId}/bundel`);
      if (antwoord.status === 401) {
        await laadIk();
        return;
      }
      if (!antwoord.ok) {
        // Toegang ingetrokken of reis afgesloten: ook de kopie op dit toestel moet weg.
        await wisReis(reisId);
        setBundel(null);
        setGeenToegang(true);
        laadIk();
        return;
      }
      const vers = antwoord.data;
      const vorige = (await lees(`bundel:${reisId}`))?.bundel;
      let m = (await lees(`merken:${reisId}`)) || { items: {}, vervallen: [] };
      if (vorige && !vers.reis.mag_beheren) {
        const v = verschillen(vorige, vers);
        m = { items: { ...m.items, ...v.items }, vervallen: [...m.vervallen, ...v.vervallen] };
      }
      const bestaand = new Set(vers.dagen.flatMap((d) => d.onderdelen.map((o) => o.id)));
      m.items = Object.fromEntries(Object.entries(m.items).filter(([id]) => bestaand.has(id)));
      const moment_ = Date.now();
      await bewaar(`bundel:${reisId}`, { bundel: vers, opgehaald: moment_ });
      await bewaar(`merken:${reisId}`, m);
      setBundel(vers);
      setOpgehaald(moment_);
      setMerken(m);
      setGeenToegang(false);
      setVerbinding('online');
      // Eigen foto's van de reisleiding ook op het toestel zetten, voor zonder internet.
      bewaarFotos([vers.reis.omslag_afbeelding_id, ...vers.berichten.map((b) => b.afbeelding_id),
        ...vers.dagen.flatMap((d) => [d.afbeelding_id, ...d.onderdelen.map((o) => o.afbeelding_id)])].filter(Boolean));
    } catch (e) {
      if (!(e instanceof GeenVerbinding)) throw e;
      setVerbinding('offline');
    }
  }, [reisId]);

  useEffect(() => {
    let actief = true;
    (async () => {
      const bewaard = await lees(`bundel:${reisId}`);
      const m = await lees(`merken:${reisId}`);
      const g = await lees(`gelezen:${reisId}`);
      if (!actief) return;
      if (bewaard) {
        setBundel(bewaard.bundel);
        setOpgehaald(bewaard.opgehaald);
      }
      if (m) setMerken(m);
      if (g) setGelezenTot(g);
      await ververs();
    })();
    const alsZichtbaar = () => {
      if (document.visibilityState === 'visible') ververs();
    };
    const klok = setInterval(() => {
      setNu(new Date());
      alsZichtbaar();
    }, 60000);
    window.addEventListener('online', alsZichtbaar);
    window.addEventListener('offline', alsZichtbaar);
    document.addEventListener('visibilitychange', alsZichtbaar);
    return () => {
      actief = false;
      clearInterval(klok);
      window.removeEventListener('online', alsZichtbaar);
      window.removeEventListener('offline', alsZichtbaar);
      document.removeEventListener('visibilitychange', alsZichtbaar);
    };
  }, [reisId]);

  // Berichten gelden als gelezen zodra het tabblad Berichten open staat.
  const nieuwste = bundel?.berichten[0]?.geplaatst_op || '';
  const [gelezenBijOpenen, setGelezenBijOpenen] = useState(null);
  useEffect(() => {
    if (tab !== 'berichten') {
      setGelezenBijOpenen(null);
      return;
    }
    if (gelezenBijOpenen === null && bundel) setGelezenBijOpenen(gelezenTot);
    if (nieuwste && nieuwste > gelezenTot) {
      setGelezenTot(nieuwste);
      bewaar(`gelezen:${reisId}`, nieuwste);
    }
  }, [tab, nieuwste, Boolean(bundel)]);

  async function begrepen() {
    const leeg = { items: {}, vervallen: [] };
    setMerken(leeg);
    await bewaar(`merken:${reisId}`, leeg);
  }

  const meerdereReizen = (ik?.reizen.length || 0) > 1 || ik?.organisaties.some((o) => o.beheerder);
  const naarTab = (e, naam) => {
    e.preventDefault();
    ga(`/reis/${reisId}/${naam}`);
  };

  if (geenToegang) {
    return html`
      <main class="smal">
        <h1>Geen toegang</h1>
        <p>Je hebt geen toegang (meer) tot deze reis. De gegevens van deze reis zijn van dit toestel verwijderd.</p>
        <p>Denk je dat dit niet klopt? Neem dan contact op met je reisleiding.</p>
        <p><a class="knop" href="/" onClick=${(e) => { e.preventDefault(); ga('/'); }}>Naar mijn reizen</a></p>
      </main>`;
  }
  if (!bundel) {
    return html`
      <main class="smal">
        ${verbinding === 'offline'
          ? html`<h1>Geen verbinding</h1>
              <p>Het programma van deze reis staat nog niet op dit toestel. Open de app één keer met internet, daarna werkt het programma ook zonder.</p>
              <p><button class="knop" onClick=${ververs}>Opnieuw proberen</button></p>`
          : html`<p class="laden">Het programma wordt opgehaald…</p>`}
      </main>`;
  }

  const { reis } = bundel;
  const magBeheren = reis.mag_beheren;
  const ongelezen = bundel.berichten.filter((b) => b.geplaatst_op > gelezenTot).length;
  const tabs = magBeheren ? [...TABS, ['beheer', 'Groep']] : TABS;
  const actief = tabs.some(([naam]) => naam === tab) ? tab : 'programma';
  const online = verbinding !== 'offline';

  return html`
    <div class="reis">
      <header class="kop beeldvlak">
        <${Sfeerbeeld} naam=${reis.omslag} eigen=${reis.omslag_afbeelding_id} />
        ${meerdereReizen && html`<a class="terug" href="/" onClick=${(e) => { e.preventDefault(); ga('/'); }}><${Icoon} naam="terug" /> Alle reizen</a>`}
        <p class="kop-org">${reis.organisatie}</p>
        <h1>${reis.titel}</h1>
        ${reis.ondertitel && html`<p class="kop-onder">${reis.ondertitel}</p>`}
      </header>
      <${StatusBalk} verbinding=${verbinding} opgehaald=${opgehaald} />
      <main class="inhoud" id="inhoud">
        ${actief === 'programma' && html`<${Programma} bundel=${bundel} merken=${merken} begrepen=${begrepen} nu=${nu}
            magBeheren=${magBeheren} ververs=${ververs} gelezenTot=${gelezenTot} naarBerichten=${(e) => naarTab(e, 'berichten')} />`}
        ${actief === 'berichten' && html`<${Berichten} bundel=${bundel} magBeheren=${magBeheren} ververs=${ververs} gelezenTot=${gelezenBijOpenen ?? gelezenTot} />`}
        ${actief === 'info' && html`<${Info} bundel=${bundel} magBeheren=${magBeheren} ververs=${ververs} ik=${ik} uitloggen=${uitloggen} reisId=${reisId} />`}
        ${actief === 'notities' && html`<${Notities} reisId=${reisId} />`}
        ${actief === 'beheer' && html`<${Beheer} reis=${reis} ververs=${ververs} online=${online} laadIk=${laadIk} ga=${ga} />`}
      </main>
      <nav class="tabs" aria-label="Onderdelen van deze reis">
        ${tabs.map(([naam, label]) => html`
          <a href=${`/reis/${reisId}/${naam}`} class=${naam === actief ? 'actief' : ''} aria-current=${naam === actief ? 'page' : null}
             onClick=${(e) => naarTab(e, naam)}>
            <${Icoon} naam=${naam} />
            <span>${label}</span>
            ${naam === 'berichten' && ongelezen > 0 && html`<span class="teller">${ongelezen}<span class="verborgen"> ongelezen</span></span>`}
          </a>`)}
      </nav>
    </div>`;
}

function StatusBalk({ verbinding, opgehaald }) {
  if (!opgehaald) return null;
  if (verbinding === 'offline') {
    const oud = Date.now() - opgehaald > VEROUDERD_NA;
    return html`
      <p class="status offline" role="status">
        <strong>Geen verbinding.</strong> Je ziet het programma zoals opgehaald ${moment(opgehaald)}.
        ${oud && ' Het kan sindsdien gewijzigd zijn; vraag het bij twijfel na bij je reisleiding.'}
      </p>`;
  }
  return html`<p class="status" role="status">${verbinding === 'bezig' ? 'Bezig met bijwerken…' : `Bijgewerkt ${moment(opgehaald)}`}</p>`;
}

// ---------------------------------------------------------------------------
// Programma
// ---------------------------------------------------------------------------

function kiesDag(dagen, vandaag) {
  return (dagen.find((d) => d.datum === vandaag) || dagen.find((d) => d.datum > vandaag) || dagen[dagen.length - 1])?.id;
}

function Programma({ bundel, merken, begrepen, nu, magBeheren, ververs, gelezenTot, naarBerichten }) {
  const vandaag = isoDatum(nu);
  const tijdNu = klokTijd(nu);
  const { dagen } = bundel;
  const [gekozen, setGekozen] = useState(null);
  const [venster, setVenster] = useState(null);
  const dag = dagen.find((d) => d.id === gekozen) || dagen.find((d) => d.id === kiesDag(dagen, vandaag));
  const kiezer = useRef();

  useEffect(() => {
    kiezer.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [dag?.id]);

  const belangrijk = bundel.berichten.find((b) => b.belangrijk && b.geplaatst_op > gelezenTot);
  const aantalGewijzigd = Object.keys(merken.items).length;
  const dagMetWijziging = (d) => d.onderdelen.some((o) => merken.items[o.id]);
  const klaar = () => {
    setVenster(null);
    ververs();
  };

  if (!dag) {
    return html`
      <p class="leeg">Er staat nog geen programma in deze reis.</p>
      ${magBeheren && html`<p><button class="knop" onClick=${() => setVenster({ soort: 'dag-nieuw' })}>Dag toevoegen</button></p>`}
      ${venster && html`<${DagVenster} reis=${bundel.reis} onKlaar=${klaar} onSluit=${() => setVenster(null)} />`}`;
  }

  const isVandaag = dag.datum === vandaag;
  const eerstvolgende = isVandaag ? dag.onderdelen.find((o) => moetErZijn(o) && moetErZijn(o) >= tijdNu) : null;
  const voorbij = (o) => isVandaag && (o.eind_tijd || o.begin_tijd) && (o.eind_tijd || o.begin_tijd) < tijdNu && o !== eerstvolgende;

  // Volgorde op het scherm: eerst het antwoord op "waar moet ik zijn en hoe laat",
  // dan pas meldingen en de rest van de dag.
  return html`
    <div class="dagkiezer" ref=${kiezer} role="group" aria-label="Kies een dag">
      ${dagen.map((d) => html`
        <button type="button" class="dagknop" aria-pressed=${d.id === dag.id ? 'true' : 'false'} onClick=${() => setGekozen(d.id)}>
          <span class="dag-week">${d.datum === vandaag ? 'vandaag' : weekdagKort(d.datum)}</span>
          <span class="dag-datum">${dagMaand(d.datum)}</span>
          ${dagMetWijziging(d) && html`<span class="stip" aria-hidden="true"></span><span class="verborgen">gewijzigd</span>`}
        </button>`)}
    </div>

    ${eerstvolgende && html`
      <div class="eerstvolgende" role="region" aria-label="Eerstvolgende">
        <p class="etiket">Eerstvolgende</p>
        <p class="groot">${eerstvolgende.verzameltijd ? 'Aanwezig om ' : ''}<span class="groot-tijd">${eerstvolgende.verzameltijd || eerstvolgende.begin_tijd}</span></p>
        <p class="eerst-titel">${eerstvolgende.titel}${eerstvolgende.verzameltijd && eerstvolgende.begin_tijd ? ` (begint om ${eerstvolgende.begin_tijd})` : ''}</p>
        ${eerstvolgende.verzamelpunt && html`<p class="eerst-plek"><${Icoon} naam="plek" /> <span>${eerstvolgende.verzamelpunt}</span></p>`}
      </div>`}

    ${belangrijk && html`
      <a class="belangrijk-balk" href="#" onClick=${naarBerichten}>
        <strong>Belangrijk bericht van ${belangrijk.auteur_naam}:</strong>
        ${' '}${belangrijk.tekst.length > 140 ? `${belangrijk.tekst.slice(0, 140)}…` : belangrijk.tekst}
        <span class="lees-meer">Lees het bericht</span>
      </a>`}

    ${(aantalGewijzigd > 0 || merken.vervallen.length > 0) && html`
      <section class="gewijzigd-balk" aria-label="Wijzigingen in het programma">
        <p><strong>Het programma is gewijzigd.</strong>
          ${aantalGewijzigd > 0 && ` ${aantalGewijzigd === 1 ? 'Eén onderdeel is' : `${aantalGewijzigd} onderdelen zijn`} nieuw of aangepast en hieronder gemarkeerd.`}</p>
        ${merken.vervallen.length > 0 && html`
          <ul>${merken.vervallen.map((v) => html`<li>Vervallen: ${v.tijd ? `${v.tijd} ` : ''}${v.titel} (${datumLang(v.datum)})</li>`)}</ul>`}
        <button class="knop klein" onClick=${begrepen}>Begrepen</button>
      </section>`}

    <section class="dag" aria-labelledby="dag-titel">
      <div class="dag-kop">
        <p class="dag-datum-lang">${datumLang(dag.datum)}${isVandaag ? ' (vandaag)' : ''}</p>
        <h2 id="dag-titel">${dag.titel || 'Programma'}</h2>
        ${dag.ondertitel && html`<p class="dag-ondertitel">${dag.ondertitel}</p>`}
        ${dag.toelichting && html`<p class="dag-toelichting">${metLinks(dag.toelichting)}</p>`}
        <${Foto} id=${dag.afbeelding_id} alt=${`Foto bij ${dag.titel || datumLang(dag.datum)}`} />
      </div>

      ${dag.onderdelen.length === 0
        ? html`<p class="leeg">Voor deze dag staan geen vaste onderdelen op het programma.</p>`
        : html`<ol class="onderdelen">
            ${dag.onderdelen.map((o) => html`<${Onderdeel} o=${o} merk=${merken.items[o.id]} voorbij=${voorbij(o)}
                magBeheren=${magBeheren} wijzig=${() => setVenster({ soort: 'onderdeel', onderdeel: o })} />`)}
          </ol>`}

      ${magBeheren && html`
        <div class="beheerknoppen niet-afdrukken">
          <button class="knop" onClick=${() => setVenster({ soort: 'onderdeel' })}>Onderdeel toevoegen</button>
          <button class="knop tweede" onClick=${() => setVenster({ soort: 'dag' })}>Dag wijzigen</button>
          <button class="knop tweede" onClick=${() => setVenster({ soort: 'dag-nieuw' })}>Dag toevoegen</button>
          <button class="knop tweede" onClick=${() => window.print()}>Programma afdrukken</button>
        </div>`}
    </section>

    ${magBeheren && html`<${Afdruk} bundel=${bundel} />`}
    ${venster?.soort === 'onderdeel' && html`<${OnderdeelVenster} reis=${bundel.reis} dag=${dag} onderdeel=${venster.onderdeel} onKlaar=${klaar} onSluit=${() => setVenster(null)} />`}
    ${venster?.soort === 'dag' && html`<${DagVenster} reis=${bundel.reis} dag=${dag} onKlaar=${klaar} onSluit=${() => setVenster(null)} />`}
    ${venster?.soort === 'dag-nieuw' && html`<${DagVenster} reis=${bundel.reis} onKlaar=${klaar} onSluit=${() => setVenster(null)} />`}`;
}

function Onderdeel({ o, merk, voorbij, magBeheren, wijzig }) {
  return html`
    <li class=${`onderdeel${voorbij ? ' voorbij' : ''}${merk ? ' gemarkeerd' : ''}`}>
      <div class="tijd">
        ${o.begin_tijd && html`<span class="tijd-begin">${o.begin_tijd}</span>`}
        ${o.eind_tijd && html`<span class="tijd-eind">tot ${o.eind_tijd}</span>`}
      </div>
      <div class="onderdeel-inhoud">
        <h3>${o.titel}</h3>
        ${(merk || o.facultatief) && html`
          <p class="labels">
            ${merk && html`<span class="label gewijzigd">${merk === 'nieuw' ? 'Nieuw' : 'Gewijzigd'}</span>`}
            ${o.facultatief && html`<span class="label">Alleen als je je hebt opgegeven</span>`}
          </p>`}
        ${(o.verzameltijd || o.verzamelpunt) && html`
          <div class="verzamelen">
            <${Icoon} naam="plek" />
            <div>
              ${o.verzameltijd && html`<p class="verzamel-tijd">Aanwezig om <strong>${o.verzameltijd}</strong></p>`}
              ${o.verzamelpunt && html`<p class="verzamel-plek"><span class="verborgen">Verzamelpunt: </span>${o.verzamelpunt}</p>`}
            </div>
          </div>`}
        <${Foto} id=${o.afbeelding_id} alt=${`Foto bij ${o.titel}`} />
        ${o.omschrijving && html`<p class="omschrijving">${metLinks(o.omschrijving)}</p>`}
        ${o.meenemen && html`<p class="meenemen"><strong>Meenemen:</strong> ${o.meenemen}</p>`}
        ${magBeheren && html`<button class="knop klein tweede niet-afdrukken" onClick=${wijzig} aria-label=${`Wijzig ${o.titel}`}>Wijzig</button>`}
      </div>
    </li>`;
}

// Volledig programma op papier, voor deelnemers zonder smartphone.
function Afdruk({ bundel }) {
  return html`
    <section class="alleen-afdrukken">
      <h1>${bundel.reis.titel}</h1>
      <p>${bundel.reis.organisatie}</p>
      ${bundel.dagen.map((d) => html`
        <div class="afdruk-dag">
          <h2>${datumLang(d.datum)}${d.titel ? `: ${d.titel}` : ''}</h2>
          ${d.ondertitel && html`<p><em>${d.ondertitel}</em></p>`}
          ${d.toelichting && html`<p>${d.toelichting}</p>`}
          ${d.onderdelen.map((o) => html`
            <p class="afdruk-onderdeel"><strong>${o.begin_tijd ? `${o.begin_tijd}${o.eind_tijd ? ` tot ${o.eind_tijd}` : ''} ` : ''}${o.titel}</strong>${o.facultatief ? ' (alleen als je je hebt opgegeven)' : ''}
              ${(o.verzameltijd || o.verzamelpunt) && html`<br />Verzamelen${o.verzameltijd ? ` om ${o.verzameltijd}` : ''}${o.verzamelpunt ? `: ${o.verzamelpunt}` : ''}`}
              ${o.omschrijving && html`<br />${o.omschrijving}`}
              ${o.meenemen && html`<br />Meenemen: ${o.meenemen}`}</p>`)}
        </div>`)}
    </section>`;
}

// ---------------------------------------------------------------------------
// Berichten
// ---------------------------------------------------------------------------

function Berichten({ bundel, magBeheren, ververs, gelezenTot }) {
  const [fout, setFout] = useState('');
  async function verwijder(b) {
    if (!window.confirm('Dit bericht verwijderen voor de hele groep?')) return;
    try {
      const antwoord = await api('DELETE', `/api/berichten/${b.id}`);
      if (!antwoord.ok) setFout(antwoord.fout);
      ververs();
    } catch (e) {
      if (!(e instanceof GeenVerbinding)) throw e;
      setFout('Geen verbinding. Verwijderen kan alleen als je internet hebt.');
    }
  }
  return html`
    <h2>Berichten</h2>
    ${magBeheren && html`<${BerichtFormulier} reis=${bundel.reis} onKlaar=${ververs} />`}
    <${Melding}>${fout}<//>
    ${bundel.berichten.length === 0 && html`<p class="leeg">Er zijn nog geen berichten van de reisleiding.</p>`}
    <ul class="berichten">
      ${bundel.berichten.map((b) => html`
        <li class=${`bericht${b.belangrijk ? ' belangrijk' : ''}`}>
          <p class="bericht-kop">
            ${b.belangrijk && html`<span class="label gewijzigd">Belangrijk</span>`}
            ${b.geplaatst_op > gelezenTot && !magBeheren && html`<span class="label">Nieuw</span>`}
            <span class="bericht-van">${b.auteur_naam}, ${moment(Date.parse(b.geplaatst_op))}</span>
          </p>
          <p class="bericht-tekst">${metLinks(b.tekst)}</p>
          <${Foto} id=${b.afbeelding_id} alt=${`Foto bij bericht van ${b.auteur_naam}`} />
          ${magBeheren && html`<button class="knop klein tweede" onClick=${() => verwijder(b)}>Verwijder</button>`}
        </li>`)}
    </ul>`;
}

// ---------------------------------------------------------------------------
// Praktische informatie
// ---------------------------------------------------------------------------

function Info({ bundel, magBeheren, ververs, ik, uitloggen }) {
  const [venster, setVenster] = useState(null);
  const klaar = () => {
    setVenster(null);
    ververs();
  };
  const namen = [...new Set((ik?.leden || []).map((l) => l.naam))];
  return html`
    <h2>Praktische informatie</h2>
    ${bundel.groepsleiders.length > 0 && html`
      <p class="leiders">Je reisleiding: <strong>${bundel.groepsleiders.join(', ')}</strong></p>`}
    ${bundel.info.length === 0 && html`<p class="leeg">Er is nog geen praktische informatie toegevoegd.</p>`}
    ${bundel.info.map((blok) => html`
      <article class="infoblok">
        <h3>${blok.titel}</h3>
        <p class="infotekst">${metLinks(blok.tekst)}</p>
        ${magBeheren && html`<button class="knop klein tweede" onClick=${() => setVenster({ blok })} aria-label=${`Wijzig ${blok.titel}`}>Wijzig</button>`}
      </article>`)}
    ${magBeheren && html`<p><button class="knop" onClick=${() => setVenster({})}>Informatie toevoegen</button></p>`}

    <${Installeren} />

    <section class="toestel">
      <h3>Dit toestel</h3>
      <p>${namen.length ? html`Ingelogd als <strong>${namen.join(' en ')}</strong>.` : 'Je bent ingelogd.'}
        ${' '}Het programma, de informatie en de berichten staan ook op dit toestel, zodat je ze zonder internet kunt bekijken.</p>
      <button class="knop tweede" onClick=${uitloggen}>Uitloggen</button>
    </section>
    ${venster && html`<${InfoVenster} reis=${bundel.reis} blok=${venster.blok} onKlaar=${klaar} onSluit=${() => setVenster(null)} />`}`;
}

// Installeren op het beginscherm. Android en desktop bieden een knop; op iPhone
// en iPad moet het via het deelmenu en leggen we uit hoe.
let installatieVraag = null;
const luisteraars = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installatieVraag = e;
  luisteraars.forEach((f) => f());
});

function Installeren() {
  const [, opnieuw] = useState(0);
  useEffect(() => {
    const f = () => opnieuw((n) => n + 1);
    luisteraars.add(f);
    return () => luisteraars.delete(f);
  }, []);
  const staatErAl = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (staatErAl) return null;
  const isApple = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return html`
    <section class="installeren">
      <h3>Zet de app op je beginscherm</h3>
      <p>Dan open je het programma met één tik, ook zonder internet.</p>
      ${installatieVraag
        ? html`<button class="knop" onClick=${async () => { await installatieVraag.prompt(); installatieVraag = null; opnieuw((n) => n + 1); }}>Installeren</button>`
        : isApple
          ? html`<ol><li>Tik onderin Safari op het deel-icoon (het vierkantje met de pijl omhoog).</li><li>Kies <strong>Zet op beginscherm</strong>.</li><li>Tik op <strong>Voeg toe</strong>.</li></ol>
              <p class="uitleg">Vraagt de app daarna opnieuw om in te loggen? Kies dan Inloggen en vul je e-mailadres in.</p>`
          : html`<p class="uitleg">Open het menu van je browser en kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>.</p>`}
    </section>`;
}

// ---------------------------------------------------------------------------
// Privénotities: staan alleen op dit toestel en gaan nooit naar de server.
// ---------------------------------------------------------------------------

function Notities({ reisId }) {
  const [tekst, setTekst] = useState(null);
  const [status, setStatus] = useState('');
  const klok = useRef();
  useEffect(() => {
    lees(`notitie:${reisId}`).then((n) => setTekst(n || ''));
    return () => clearTimeout(klok.current);
  }, [reisId]);

  function wijzig(waarde) {
    setTekst(waarde);
    setStatus('');
    clearTimeout(klok.current);
    klok.current = setTimeout(async () => {
      const gelukt = await bewaar(`notitie:${reisId}`, waarde);
      setStatus(gelukt ? `Bewaard op dit toestel om ${klokTijd()}` : 'Bewaren is niet gelukt. Dit toestel staat opslaan niet toe.');
    }, 500);
  }

  return html`
    <h2>Mijn notities</h2>
    <p class="uitleg">Alleen jij ziet deze notities. Ze staan alleen op dit toestel, werken ook zonder internet en verdwijnen als je uitlogt.</p>
    ${tekst === null
      ? html`<p class="laden">Notities laden…</p>`
      : html`<label class="verborgen" for="notitie">Mijn notities</label>
          <textarea id="notitie" class="notitie" rows="12" value=${tekst} placeholder="Bijvoorbeeld je hutnummer, je tafeltijd of wat je niet wilt vergeten."
            onInput=${(e) => wijzig(e.target.value)}></textarea>
          <p class="uitleg" role="status">${status}</p>`}`;
}

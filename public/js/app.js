// Mee op Reis: start van de app, inloggen en het overzicht van je reizen.
import { html, render, useCallback, useEffect, useState } from './vendor/preact-htm.js';
import { api, GeenVerbinding } from './api.js';
import { lees, bewaar, sleutels, verwijder, wisAlles } from './opslag.js';
import { periode } from './hulp.js';
import { Melding, Sfeerbeeld, Veld, useActie } from './onderdelen.js';
import { ReisScherm } from './reis.js';
import { ReisVenster } from './beheer.js';

const UITGESTELD = 'uitloggen-uitgesteld';

function App() {
  const [pad, setPad] = useState(location.pathname);
  const [ik, setIk] = useState(undefined); // undefined = nog bezig, null = niet ingelogd
  const [offline, setOffline] = useState(false);

  const ga = useCallback((nieuw, { vervang = false } = {}) => {
    if (nieuw !== location.pathname) history[vervang ? 'replaceState' : 'pushState'](null, '', nieuw);
    setPad(nieuw);
    window.scrollTo(0, 0);
  }, []);

  // Haalt op wie er is ingelogd en houdt de opslag op dit toestel daarmee in
  // de pas: een andere sessie of een verlopen sessie betekent alles wissen.
  const laadIk = useCallback(async () => {
    try {
      if (localStorage.getItem(UITGESTELD)) {
        // Er is zonder verbinding uitgelogd: maak dat eerst af op de server.
        await api('POST', '/api/uitloggen', {});
        localStorage.removeItem(UITGESTELD);
      }
      const antwoord = await api('GET', '/api/ik');
      if (antwoord.status === 401) {
        await wisAlles();
        setOffline(false);
        setIk(null);
        return null;
      }
      const eigenaar = await lees('eigenaar');
      if (eigenaar && eigenaar !== antwoord.data.sessie_id) await wisAlles();
      await bewaar('eigenaar', antwoord.data.sessie_id);
      await bewaar('ik', antwoord.data);
      const mijnReizen = new Set(antwoord.data.reizen.map((r) => r.id));
      for (const sleutel of await sleutels()) {
        const [soort, reisId] = String(sleutel).split(':');
        if (reisId && ['bundel', 'merken', 'gelezen', 'notitie'].includes(soort) && !mijnReizen.has(reisId)) await verwijder(sleutel);
      }
      setOffline(false);
      setIk(antwoord.data);
      return antwoord.data;
    } catch (e) {
      if (!(e instanceof GeenVerbinding)) throw e;
      const bewaard = localStorage.getItem(UITGESTELD) ? null : await lees('ik');
      setOffline(true);
      setIk(bewaard || null);
      return bewaard || null;
    }
  }, []);

  const uitloggen = useCallback(async () => {
    if (!window.confirm('Uitloggen? Het programma en je notities worden van dit toestel gewist.')) return;
    await wisAlles();
    try {
      await api('POST', '/api/uitloggen', {});
    } catch {
      localStorage.setItem(UITGESTELD, '1');
    }
    setIk(null);
    ga('/inloggen', { vervang: true });
  }, []);

  useEffect(() => {
    laadIk();
    const terug = () => setPad(location.pathname);
    window.addEventListener('popstate', terug);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => window.removeEventListener('popstate', terug);
  }, []);

  const delen = pad.split('/').filter(Boolean);
  if (delen[0] === 'u' && delen[1]) return html`<${Uitnodiging} token=${delen[1]} ik=${ik} ga=${ga} laadIk=${laadIk} />`;
  if (delen[0] === 'l' && delen[1]) return html`<${LoginLink} token=${delen[1]} ga=${ga} laadIk=${laadIk} />`;
  if (ik === undefined) return html`<p class="laden">Mee op Reis wordt geladen…</p>`;
  if (ik === null) return html`<${Inloggen} offline=${offline} ga=${ga} laadIk=${laadIk} />`;
  if (delen[0] === 'reis' && delen[1]) {
    return html`<${ReisScherm} key=${delen[1]} reisId=${delen[1]} tab=${delen[2] || 'programma'} ik=${ik} ga=${ga} laadIk=${laadIk} uitloggen=${uitloggen} />`;
  }
  return html`<${Start} ik=${ik} offline=${offline} ga=${ga} laadIk=${laadIk} uitloggen=${uitloggen} />`;
}

function Merk() {
  return html`<p class="merk"><img src="/icons/icon-192.png" alt="" width="38" height="38" /> Mee op Reis</p>`;
}

// Entree: sfeerbeeld bovenaan, de inhoud op een kaart die eroverheen schuift.
function Entree({ omslag, children }) {
  return html`
    <div class="entree">
      <div class="entree-beeld beeldvlak"><${Sfeerbeeld} naam=${omslag} /><${Merk} /></div>
      <main class="entree-kaart">${children}</main>
    </div>`;
}

// ---------------------------------------------------------------------------
// Overzicht van je reizen (en voor beheerders: reizen aanmaken)
// ---------------------------------------------------------------------------

function Start({ ik, offline, ga, laadIk, uitloggen }) {
  const [nieuweReisVoor, setNieuweReisVoor] = useState(null);
  const beheerOrgs = ik.organisaties.filter((o) => o.beheerder);
  const open = (id) => (e) => {
    e.preventDefault();
    ga(`/reis/${id}/programma`);
  };

  // Wie maar één reis heeft, hoeft niet te kiezen.
  useEffect(() => {
    if (ik.reizen.length === 1 && beheerOrgs.length === 0) ga(`/reis/${ik.reizen[0].id}/programma`, { vervang: true });
  }, [ik]);

  const kaart = (r) => html`
    <li>
      <a class="reiskaart" href=${`/reis/${r.id}/programma`} onClick=${open(r.id)}>
        <span class="reiskaart-beeld beeldvlak"><${Sfeerbeeld} naam=${r.omslag} lui /></span>
        <span class="reiskaart-tekst">
          <span class="reiskaart-titel">${r.titel}</span>
          <span class="reiskaart-datum">${periode(r.start_datum, r.eind_datum)}</span>
          ${r.gearchiveerd
            ? html`<span class="label">Afgesloten</span>`
            : r.rol === 'groepsleider' ? html`<span class="label">Je bent groepsleider</span>` : null}
        </span>
      </a>
    </li>`;
  const namen = [...new Set(ik.leden.map((l) => l.naam))];

  return html`
    <div class="start">
    <header class="start-kop beeldvlak"><${Sfeerbeeld} naam="zee" /><${Merk} /><h1>Mijn reizen</h1></header>
    <main class="smal">
      ${offline && html`<p class="status offline" role="status"><strong>Geen verbinding.</strong> Je ziet de reizen die op dit toestel staan.</p>`}
      ${ik.reizen.length === 0 && beheerOrgs.length === 0 && html`
        <p class="leeg">Er staan op dit moment geen reizen voor je klaar. Heb je een uitnodiging gekregen? Open dan de link uit die uitnodiging.</p>`}
      ${ik.organisaties.map((org) => {
        const reizen = ik.reizen.filter((r) => r.org_id === org.id);
        if (!reizen.length && !org.beheerder) return null;
        return html`
          <section class="organisatie">
            <h2>${org.naam}</h2>
            ${reizen.length === 0 ? html`<p class="leeg">Nog geen reizen.</p>` : html`<ul class="reizen">${reizen.map(kaart)}</ul>`}
            ${org.beheerder && html`<button class="knop" onClick=${() => setNieuweReisVoor(org.id)}>Nieuwe reis voor ${org.naam}</button>`}
          </section>`;
      })}
      <section class="toestel">
        <p>${namen.length ? html`Ingelogd als <strong>${namen.join(' en ')}</strong>.` : 'Je bent ingelogd.'}</p>
        <button class="knop tweede" onClick=${uitloggen}>Uitloggen</button>
      </section>
      ${nieuweReisVoor && html`<${ReisVenster} orgId=${nieuweReisVoor} onSluit=${() => setNieuweReisVoor(null)}
          onKlaar=${async (nieuw) => { setNieuweReisVoor(null); await laadIk(); ga(`/reis/${nieuw.id}/beheer`); }} />`}
    </main>
    </div>`;
}

// ---------------------------------------------------------------------------
// Uitnodiging openen
// ---------------------------------------------------------------------------

function Uitnodiging({ token, ik, ga, laadIk }) {
  const [staat, setStaat] = useState({ soort: 'laden' });
  const { bezig, fout, voerUit } = useActie();

  useEffect(() => {
    (async () => {
      try {
        const antwoord = await api('GET', `/api/uitnodigingen/${encodeURIComponent(token)}`);
        setStaat(antwoord.ok ? { soort: antwoord.data.status, ...antwoord.data } : { soort: 'ongeldig' });
      } catch (e) {
        if (!(e instanceof GeenVerbinding)) throw e;
        setStaat({ soort: 'offline' });
      }
    })();
  }, [token]);

  // Al gebruikt en op dit toestel nog ingelogd: ga gewoon door naar de reis.
  useEffect(() => {
    if (staat.soort === 'gebruikt' && ik) ga('/', { vervang: true });
  }, [staat.soort, ik]);

  async function accepteer() {
    const antwoord = await voerUit(() => api('POST', `/api/uitnodigingen/${encodeURIComponent(token)}/accepteren`, {}));
    if (!antwoord) return;
    await laadIk();
    ga(antwoord.data.reis_id ? `/reis/${antwoord.data.reis_id}/programma` : '/', { vervang: true });
  }
  const naarInloggen = (e) => {
    e.preventDefault();
    ga('/inloggen', { vervang: true });
  };

  return html`
    <${Entree} omslag=${staat.omslag}>
      ${staat.soort === 'laden' && html`<p class="laden">Je uitnodiging wordt opgezocht…</p>`}
      ${staat.soort === 'geldig' && html`
        <h1>Welkom, ${staat.naam}</h1>
        <p class="groot-tekst">${staat.organisatie} nodigt je uit${staat.rol === 'groepsleider' ? ' als groepsleider' : staat.rol === 'beheerder' ? ' als beheerder' : ''}${staat.reis_titel ? html` voor <strong>${staat.reis_titel}</strong>` : ''}.</p>
        <p>In deze app vind je het dagprogramma met tijden en verzamelpunten, praktische informatie en berichten van de reisleiding. Het programma blijft ook zonder internet beschikbaar.</p>
        <${Melding}>${fout}<//>
        <p><button class="knop groot" disabled=${bezig} onClick=${accepteer}>${bezig ? 'Bezig…' : staat.reis_titel ? 'Open mijn reis' : 'Ga verder'}</button></p>
        <p class="uitleg">Deze link is persoonlijk en werkt één keer. Open hem op de telefoon die je meeneemt op reis.</p>`}
      ${staat.soort === 'gebruikt' && !ik && html`
        <h1>Deze link is al gebruikt</h1>
        <p>Je uitnodiging is al eens geopend, misschien op een ander toestel. Je kunt hier inloggen met je e-mailadres.</p>
        <p><a class="knop groot" href="/inloggen" onClick=${naarInloggen}>Inloggen met e-mailadres</a></p>`}
      ${(staat.soort === 'verlopen' || staat.soort === 'ingetrokken') && html`
        <h1>Deze link werkt niet meer</h1>
        <p>${staat.soort === 'verlopen' ? 'De uitnodiging is verlopen.' : 'De uitnodiging is ingetrokken.'} Vraag je reisleiding om een nieuwe link.</p>`}
      ${staat.soort === 'ongeldig' && html`
        <h1>Deze link klopt niet</h1>
        <p>Controleer of je de hele link hebt geopend. Heb je de app al eerder gebruikt? Dan kun je inloggen met je e-mailadres.</p>
        <p><a class="knop" href="/inloggen" onClick=${naarInloggen}>Inloggen met e-mailadres</a></p>`}
      ${staat.soort === 'offline' && html`
        <h1>Geen verbinding</h1>
        <p>Om je uitnodiging te openen heb je één keer internet nodig. Open de link opnieuw zodra je verbinding hebt.</p>
        <p><button class="knop" onClick=${() => location.reload()}>Opnieuw proberen</button></p>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Inloggen met je e-mailadres: je krijgt een code (en een link) per mail.
// ---------------------------------------------------------------------------

function Inloggen({ offline, ga, laadIk }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stap, setStap] = useState('email');
  const { bezig, fout, voerUit } = useActie();

  async function vraagAan(e) {
    e.preventDefault();
    if (await voerUit(() => api('POST', '/api/inloggen/aanvragen', { email }))) setStap('code');
  }
  async function controleer(e) {
    e.preventDefault();
    if (await voerUit(() => api('POST', '/api/inloggen/code', { email, code }))) {
      await laadIk();
      ga('/', { vervang: true });
    }
  }

  return html`
    <${Entree}>
      <h1>Inloggen</h1>
      ${offline && html`<p class="status offline" role="status"><strong>Geen verbinding.</strong> Inloggen kan alleen als je internet hebt.</p>`}
      ${stap === 'email' ? html`
        <p>Heb je een uitnodiging gekregen? Open dan de link uit die uitnodiging. Gebruikte je de app al eerder, vul dan hier je e-mailadres in.</p>
        <form onSubmit=${vraagAan}>
          <${Veld} label="E-mailadres" soort="email" waarde=${email} zet=${setEmail} verplicht autocomplete="email" inputmode="email"
            uitleg="Het adres waarop je de uitnodiging voor je reis hebt gekregen." />
          <${Melding}>${fout}<//>
          <button class="knop groot" type="submit" disabled=${bezig}>${bezig ? 'Bezig…' : 'Stuur mij een inlogcode'}</button>
        </form>` : html`
        <p>Als <strong>${email}</strong> bij een reis hoort, staat er binnen een paar minuten een mail met een code van 6 cijfers in je postvak. Kijk ook bij ongewenste mail.</p>
        <form onSubmit=${controleer}>
          <${Veld} label="Inlogcode" waarde=${code} zet=${setCode} verplicht inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="codeveld" />
          <${Melding}>${fout}<//>
          <button class="knop groot" type="submit" disabled=${bezig}>${bezig ? 'Bezig…' : 'Log in'}</button>
        </form>
        <p><button class="knop kaal" onClick=${() => { setStap('email'); setCode(''); }}>Ander e-mailadres of nieuwe code</button></p>`}
    <//>`;
}

function LoginLink({ token, ga, laadIk }) {
  const { bezig, fout, voerUit } = useActie();
  async function login() {
    if (await voerUit(() => api('POST', '/api/inloggen/link', { token }))) {
      await laadIk();
      ga('/', { vervang: true });
    }
  }
  return html`
    <${Entree}>
      <h1>Inloggen</h1>
      <p>Tik op de knop om op dit toestel in te loggen.</p>
      <${Melding}>${fout}<//>
      <p><button class="knop groot" disabled=${bezig} onClick=${login}>${bezig ? 'Bezig…' : 'Log in op dit toestel'}</button></p>
      <p><a href="/inloggen" onClick=${(e) => { e.preventDefault(); ga('/inloggen', { vervang: true }); }}>Liever een nieuwe code aanvragen</a></p>
    <//>`;
}

const houder = document.getElementById('app');
houder.textContent = '';
render(html`<${App} />`, houder);

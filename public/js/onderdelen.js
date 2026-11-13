// Kleine bouwstenen die op meerdere schermen terugkomen.
import { html, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { GeenVerbinding } from './api.js';

const PADEN = {
  programma: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 13h3M8 16h6',
  berichten: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  notities: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 16.5h5',
  beheer: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M17.5 14.5A5 5 0 0 1 21 20',
  terug: 'M15 5l-7 7 7 7',
  plek: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};
export function Icoon({ naam }) {
  return html`<svg class="icoon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${PADEN[naam]} /></svg>`;
}

// Venster bovenop het scherm, gebouwd op het standaard <dialog>-element zodat
// toetsenbord en schermlezers het vanzelf goed doen.
export function Venster({ titel, onSluit, children }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current.open) ref.current.showModal();
  }, []);
  return html`
    <dialog ref=${ref} class="venster" aria-labelledby="venster-titel" onClose=${onSluit}>
      <div class="venster-kop">
        <h2 id="venster-titel">${titel}</h2>
        <button type="button" class="knop kaal" onClick=${onSluit} aria-label="Sluiten">Sluiten</button>
      </div>
      ${children}
    </dialog>`;
}

let volgnummer = 0;
export function Veld({ label, uitleg, soort = 'text', waarde, zet, verplicht, rijen, ...rest }) {
  const [id] = useState(() => `veld-${(volgnummer += 1)}`);
  const invoer = soort === 'textarea'
    ? html`<textarea id=${id} rows=${rijen || 4} value=${waarde ?? ''} required=${verplicht} aria-describedby=${uitleg ? `${id}-uitleg` : null}
        onInput=${(e) => zet(e.target.value)} ...${rest}></textarea>`
    : html`<input id=${id} type=${soort} value=${waarde ?? ''} required=${verplicht} aria-describedby=${uitleg ? `${id}-uitleg` : null}
        onInput=${(e) => zet(e.target.value)} ...${rest} />`;
  return html`
    <div class="veld">
      <label for=${id}>${label}${verplicht ? '' : html` <span class="optioneel">(mag leeg)</span>`}</label>
      ${invoer}
      ${uitleg && html`<p class="uitleg" id=${`${id}-uitleg`}>${uitleg}</p>`}
    </div>`;
}

export function Vinkje({ label, waarde, zet }) {
  const [id] = useState(() => `veld-${(volgnummer += 1)}`);
  return html`
    <div class="vinkje">
      <input id=${id} type="checkbox" checked=${waarde} onChange=${(e) => zet(e.target.checked)} />
      <label for=${id}>${label}</label>
    </div>`;
}

// Voert een wijziging uit en vertaalt wat er mis kan gaan naar een melding.
export function useActie() {
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  async function voerUit(werk) {
    setBezig(true);
    setFout('');
    try {
      const antwoord = await werk();
      if (antwoord && antwoord.ok === false) {
        setFout(antwoord.fout || 'Dat is niet gelukt.');
        return null;
      }
      return antwoord ?? true;
    } catch (e) {
      if (!(e instanceof GeenVerbinding)) throw e;
      setFout('Geen verbinding. Wijzigen kan alleen als je internet hebt. Probeer het zo opnieuw.');
      return null;
    } finally {
      setBezig(false);
    }
  }
  return { bezig, fout, setFout, voerUit };
}

export const Melding = ({ soort = 'fout', children }) =>
  children ? html`<p class=${`melding ${soort}`} role=${soort === 'fout' ? 'alert' : 'status'}>${children}</p>` : null;

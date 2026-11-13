import { html } from './vendor/preact-htm.js';

const twee = (n) => String(n).padStart(2, '0');
export const isoDatum = (d = new Date()) => `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`;
export const klokTijd = (d = new Date()) => `${twee(d.getHours())}:${twee(d.getMinutes())}`;

// Een programma-dag is een kalenderdatum zonder tijdzone: reken met 12:00 lokaal.
const alsDatum = (iso) => new Date(`${iso}T12:00:00`);
const fLang = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
const fKortDag = new Intl.DateTimeFormat('nl-NL', { weekday: 'short' });
const fDagMaand = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const fJaar = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

export const datumLang = (iso) => fLang.format(alsDatum(iso));
export const weekdagKort = (iso) => fKortDag.format(alsDatum(iso)).replace('.', '');
export const dagMaand = (iso) => fDagMaand.format(alsDatum(iso)).replace('.', '');
export const periode = (start, eind) => `${fDagMaand.format(alsDatum(start)).replace('.', '')} tot en met ${fJaar.format(alsDatum(eind))}`;

// "vandaag om 14:32", "gisteren om 09:05" of "dinsdag 25 mei om 14:32"
export function moment(ms) {
  const d = new Date(ms);
  const vandaag = isoDatum();
  const gisteren = isoDatum(new Date(Date.now() - 86400000));
  const dag = isoDatum(d) === vandaag ? 'vandaag' : isoDatum(d) === gisteren ? 'gisteren' : fLang.format(d);
  return `${dag} om ${klokTijd(d)}`;
}

// Maakt van webadressen, e-mailadressen en telefoonnummers aanklikbare links.
// Geeft losse stukken tekst en link-elementen terug; er wordt nooit HTML uit
// de tekst zelf uitgevoerd.
const PATROON = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])|([^\s<>@]+@[^\s<>@]+\.[a-z]{2,})|((?:\+|00)?\d[\d \-]{7,16}\d)/gi;
export function metLinks(tekst) {
  const delen = [];
  let vorige = 0;
  for (const m of String(tekst).matchAll(PATROON)) {
    let link = null;
    if (m[1]) link = html`<a href=${m[1]} target="_blank" rel="noopener noreferrer">${m[1].replace(/^https?:\/\//, '')}</a>`;
    else if (m[2]) link = html`<a href=${`mailto:${m[2]}`}>${m[2]}</a>`;
    else {
      const cijfers = m[3].replace(/\D/g, '');
      if (cijfers.length >= 9 && cijfers.length <= 15) link = html`<a href=${`tel:${m[3].replace(/[^\d+]/g, '')}`}>${m[3]}</a>`;
    }
    if (!link) continue;
    if (m.index > vorige) delen.push(tekst.slice(vorige, m.index));
    delen.push(link);
    vorige = m.index + m[0].length;
  }
  if (vorige < tekst.length) delen.push(tekst.slice(vorige));
  return delen;
}

// Het eerstvolgende moment waarop je ergens moet zijn: de verzameltijd als die
// er is, anders de begintijd.
export const moetErZijn = (onderdeel) => onderdeel.verzameltijd || onderdeel.begin_tijd;

// Vergelijkt het vorige en het nieuwe programma en geeft terug wat er veranderd
// is, zodat een deelnemer na een periode zonder verbinding ziet wat anders is.
export function verschillen(oud, nieuw) {
  const vroeger = new Map();
  for (const dag of oud.dagen) for (const o of dag.onderdelen) vroeger.set(o.id, { ...o, datum: dag.datum });
  const items = {};
  for (const dag of nieuw.dagen) {
    for (const o of dag.onderdelen) {
      const was = vroeger.get(o.id);
      if (!was) items[o.id] = 'nieuw';
      else if (was.bijgewerkt_op !== o.bijgewerkt_op) items[o.id] = 'gewijzigd';
      vroeger.delete(o.id);
    }
  }
  const vervallen = [...vroeger.values()].map((o) => ({ titel: o.titel, datum: o.datum, tijd: o.begin_tijd }));
  return { items, vervallen };
}

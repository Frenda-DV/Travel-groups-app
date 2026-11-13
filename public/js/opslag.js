// Opslag op het toestel (IndexedDB). Hier staan het laatst opgehaalde programma,
// de privénotities en wat al gelezen is. Lukt opslaan niet (bijvoorbeeld in een
// privévenster), dan werkt de app gewoon door, alleen niet zonder internet.
const NAAM = 'mee-op-reis';
let geopend;

function open() {
  geopend ??= new Promise((klaar, mislukt) => {
    const verzoek = indexedDB.open(NAAM, 1);
    verzoek.onupgradeneeded = () => verzoek.result.createObjectStore('kv');
    verzoek.onsuccess = () => klaar(verzoek.result);
    verzoek.onerror = () => mislukt(verzoek.error);
  });
  return geopend;
}

async function transactie(modus, werk) {
  const db = await open();
  return new Promise((klaar, mislukt) => {
    const t = db.transaction('kv', modus);
    const verzoek = werk(t.objectStore('kv'));
    t.oncomplete = () => klaar(verzoek?.result);
    t.onerror = () => mislukt(t.error);
    t.onabort = () => mislukt(t.error);
  });
}

export const lees = (sleutel) => transactie('readonly', (s) => s.get(sleutel)).catch(() => undefined);
export const bewaar = (sleutel, waarde) => transactie('readwrite', (s) => s.put(waarde, sleutel)).then(() => true, () => false);
export const verwijder = (sleutel) => transactie('readwrite', (s) => s.delete(sleutel)).catch(() => {});
export const sleutels = () => transactie('readonly', (s) => s.getAllKeys()).catch(() => []);
// Foto's van de reisleiding staan in een eigen opslag van de browser (zie sw.js).
export const FOTO_OPSLAG = 'mee-op-reis-fotos';
const wisFotos = () => (globalThis.caches ? caches.delete(FOTO_OPSLAG).catch(() => {}) : Promise.resolve());

export async function wisAlles() {
  await transactie('readwrite', (s) => s.clear()).catch(() => {});
  await wisFotos();
}

// Zet de foto's van een reis op het toestel, zodat ze ook zonder internet te zien zijn.
export async function bewaarFotos(ids) {
  if (!globalThis.caches || !ids.length) return;
  try {
    const opslag = await caches.open(FOTO_OPSLAG);
    for (const id of ids) {
      const adres = `/api/afbeeldingen/${id}`;
      if (!(await opslag.match(adres))) await opslag.add(adres).catch(() => {});
    }
  } catch { /* geen opslag beschikbaar: de foto's werken dan alleen met internet */ }
}

export async function wisReis(reisId) {
  for (const soort of ['bundel', 'merken', 'gelezen', 'notitie']) await verwijder(`${soort}:${reisId}`);
  await wisFotos(); // foto's van andere reizen worden bij het volgende bezoek opnieuw opgehaald
}

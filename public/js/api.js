// Praten met de server. Alles wat geen geldig antwoord van onze eigen server
// oplevert telt als "geen verbinding": een weggevallen netwerk, een trage
// scheepswifi (na 12 seconden) of een inlogpagina van de wifi-aanbieder.
export class GeenVerbinding extends Error {}
// De server is wel bereikbaar maar heeft een storing. Telt voor het tonen van
// het opgeslagen programma als "geen verbinding", maar krijgt een eigen melding.
export class ServerStoring extends GeenVerbinding {}

export async function api(methode, pad, body) {
  const stop = new AbortController();
  // Een foto versturen via trage wifi mag langer duren dan een gewone aanvraag.
  const klok = setTimeout(() => stop.abort(), body instanceof Blob ? 60000 : 12000);
  let antwoord;
  try {
    antwoord = await fetch(pad, {
      method: methode,
      headers: body === undefined ? {} : { 'content-type': body instanceof Blob ? body.type : 'application/json' },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: stop.signal,
    });
  } catch {
    throw new GeenVerbinding();
  } finally {
    clearTimeout(klok);
  }
  if (!(antwoord.headers.get('content-type') || '').includes('application/json')) throw new GeenVerbinding();
  let data;
  try {
    data = await antwoord.json();
  } catch {
    throw new GeenVerbinding();
  }
  if (antwoord.status >= 500) throw new ServerStoring();
  return { ok: antwoord.ok, status: antwoord.status, data, fout: data?.fout };
}

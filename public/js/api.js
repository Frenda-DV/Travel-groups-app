// Praten met de server. Alles wat geen geldig antwoord van onze eigen server
// oplevert telt als "geen verbinding": een weggevallen netwerk, een trage
// scheepswifi (na 12 seconden) of een inlogpagina van de wifi-aanbieder.
export class GeenVerbinding extends Error {}
// De server is wel bereikbaar maar heeft een storing. Telt voor het tonen van
// het opgeslagen programma als "geen verbinding", maar krijgt een eigen melding.
export class ServerStoring extends GeenVerbinding {}

export async function api(methode, pad, body) {
  const stop = new AbortController();
  const klok = setTimeout(() => stop.abort(), 12000);
  let antwoord;
  try {
    antwoord = await fetch(pad, {
      method: methode,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

// Bepaalt met welke databaseverbindingen er gewerkt wordt. Werkt met een eigen
// .env en met de variabelen die Vercel met een Neon-database zelf aanlevert.
//
//   admin: eigenaar van de database, alleen voor migraties en inrichten
//   app:   de beperkte rol reisapp_app waarmee de app zelf draait
//
// Een database-koppeling op Vercel levert DATABASE_URL met de EIGENAAR. Daarmee
// mag de app niet draaien (row-level security geldt niet voor de eigenaar).
// Daarom wordt in dat adres de rol vervangen door reisapp_app met het
// wachtwoord uit APP_DB_PASSWORD.
export function databaseUrls(env = process.env) {
  const admin = env.DATABASE_ADMIN_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || '';
  let app = env.APP_DATABASE_URL || '';
  if (!app && env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (url.username !== 'reisapp_app' && env.APP_DB_PASSWORD) {
      url.username = 'reisapp_app';
      url.password = env.APP_DB_PASSWORD;
    }
    app = url.toString();
  }
  return { admin, app };
}

// Publiek adres voor links in mails. Leeg betekent: gebruik het adres waarop
// de aanvraag binnenkomt.
export function publiekAdres(env = process.env) {
  if (env.BASIS_URL) return env.BASIS_URL.replace(/\/$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return '';
}

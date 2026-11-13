import pg from 'pg';

// Datums als 'JJJJ-MM-DD' laten staan: een programma-dag heeft geen tijdzone.
pg.types.setTypeParser(1082, (waarde) => waarde);

export function maakPool(url) {
  return new pg.Pool({ connectionString: url, max: 10 });
}

// De hele toegangsbeveiliging leunt op row-level security. Die geldt niet voor
// superusers, voor rollen met BYPASSRLS en voor de eigenaar van de tabellen.
// Daarom weigert de app te starten als de verbinding zo'n rol gebruikt.
export async function controleerAppRol(pool) {
  const { rows } = await pool.query(`
    select current_user as rol, r.rolsuper, r.rolbypassrls,
      (select count(*) from pg_tables t
        where t.schemaname = 'public' and pg_has_role(current_user, t.tableowner, 'USAGE'))::int as eigen_tabellen,
      (select count(*) from pg_tables t
        where t.schemaname = 'public' and not t.rowsecurity and t.tablename <> 'schema_migraties')::int as zonder_rls
    from pg_roles r where r.rolname = current_user`);
  const r = rows[0];
  const problemen = [];
  if (r.rolsuper) problemen.push('de rol is superuser');
  if (r.rolbypassrls) problemen.push('de rol heeft BYPASSRLS');
  if (r.eigen_tabellen > 0) problemen.push('de rol is eigenaar van tabellen');
  if (r.zonder_rls > 0) problemen.push('er zijn tabellen zonder row-level security');
  if (problemen.length) {
    throw new Error(`Onveilige databaseverbinding (${r.rol}): ${problemen.join(', ')}. Gebruik de rol reisapp_app in DATABASE_URL.`);
  }
}

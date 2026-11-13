-- Mee op Reis: schema, toegangsregels (row-level security) en auth-functies.
--
-- Uitgangspunten:
--   * Dit bestand wordt uitgevoerd door de EIGENAAR van de database.
--   * De app verbindt als de rol reisapp_app. Die rol is geen eigenaar en valt
--     dus altijd onder row-level security. Vergeet de app een filter, dan
--     levert de database nog steeds alleen rijen waar de sessie recht op heeft.
--   * Een sessie is een verzameling lidmaatschappen. Een uitnodigingslink geeft
--     precies één lidmaatschap. Inloggen via het eigen e-mailadres geeft alle
--     lidmaatschappen van dat adres. Een groepsleider kan zich daardoor nooit
--     via een zelfgemaakte uitnodiging meer rechten toe-eigenen.
--   * Tabellen met sessies en inlogcodes zijn voor de app-rol onzichtbaar. Ze
--     zijn alleen bereikbaar via de auth_*-functies hieronder.

do $$ begin
  if not exists (select from pg_roles where rolname = 'reisapp_app') then
    create role reisapp_app nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table organisaties (
  id            uuid primary key default gen_random_uuid(),
  naam          text not null check (length(naam) between 1 and 120),
  aangemaakt_op timestamptz not null default now()
);

create table reizen (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisaties on delete cascade,
  titel         text not null check (length(titel) between 1 and 120),
  ondertitel    text not null default '' check (length(ondertitel) <= 200),
  start_datum   date not null,
  eind_datum    date not null,
  gearchiveerd  boolean not null default false,
  aangemaakt_op timestamptz not null default now(),
  check (eind_datum >= start_datum),
  check (eind_datum - start_datum <= 120),
  unique (id, org_id)
);
create index on reizen (org_id);

-- Eén rij per persoon per reis (groepsleider of deelnemer), of per persoon per
-- organisatie (beheerder, dan is reis_id leeg). De rij bestaat vanaf het moment
-- van uitnodigen; de uitnodiging zelf is een eenmalige link.
create table lidmaatschappen (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organisaties on delete cascade,
  reis_id                  uuid,
  rol                      text not null check (rol in ('beheerder', 'groepsleider', 'deelnemer')),
  email                    text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  naam                     text not null check (length(naam) between 1 and 120),
  uitnodiging_hash         text unique,
  uitnodiging_verloopt_op  timestamptz,
  uitnodiging_gebruikt_op  timestamptz,
  geaccepteerd_op          timestamptz,
  ingetrokken_op           timestamptz,
  aangemaakt_op            timestamptz not null default now(),
  foreign key (reis_id, org_id) references reizen (id, org_id) on delete cascade,
  check ((rol = 'beheerder') = (reis_id is null))
);
create unique index lidmaatschappen_reis_email on lidmaatschappen (reis_id, email) where reis_id is not null;
create unique index lidmaatschappen_org_email on lidmaatschappen (org_id, email) where reis_id is null;
create index on lidmaatschappen (email);

create table sessies (
  token_hash       text primary key,
  id               uuid not null unique default gen_random_uuid(),
  aangemaakt_op    timestamptz not null default now(),
  laatst_gezien_op timestamptz not null default now(),
  verloopt_op      timestamptz not null
);

create table sessie_toegang (
  sessie_hash     text not null references sessies (token_hash) on delete cascade,
  lidmaatschap_id uuid not null references lidmaatschappen on delete cascade,
  primary key (sessie_hash, lidmaatschap_id)
);
create index on sessie_toegang (lidmaatschap_id);

create table login_tokens (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  token_hash    text not null unique,
  code_hash     text not null,
  pogingen      int not null default 0,
  aangemaakt_op timestamptz not null default now(),
  verloopt_op   timestamptz not null,
  gebruikt_op   timestamptz
);
create index on login_tokens (email);

create table programma_dagen (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  reis_id       uuid not null,
  datum         date not null,
  titel         text not null default '' check (length(titel) <= 120),
  ondertitel    text not null default '' check (length(ondertitel) <= 200),
  toelichting   text not null default '' check (length(toelichting) <= 4000),
  bijgewerkt_op timestamptz not null default now(),
  foreign key (reis_id, org_id) references reizen (id, org_id) on delete cascade,
  unique (reis_id, datum),
  unique (id, reis_id, org_id)
);

-- Velden volgen het echte excursieprogramma: vertrektijd, een aparte tijd
-- waarop je aanwezig moet zijn, en een trefpunt met herkenningsteken.
create table programma_onderdelen (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  reis_id       uuid not null,
  dag_id        uuid not null,
  begin_tijd    time,
  eind_tijd     time,
  titel         text not null check (length(titel) between 1 and 160),
  omschrijving  text not null default '' check (length(omschrijving) <= 4000),
  verzameltijd  time,
  verzamelpunt  text not null default '' check (length(verzamelpunt) <= 500),
  meenemen      text not null default '' check (length(meenemen) <= 500),
  facultatief   boolean not null default false,
  bijgewerkt_op timestamptz not null default now(),
  foreign key (dag_id, reis_id, org_id) references programma_dagen (id, reis_id, org_id) on delete cascade
);
create index on programma_onderdelen (reis_id);

create table info_blokken (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  reis_id       uuid not null,
  titel         text not null check (length(titel) between 1 and 160),
  tekst         text not null default '' check (length(tekst) <= 8000),
  volgorde      int not null default 0,
  bijgewerkt_op timestamptz not null default now(),
  foreign key (reis_id, org_id) references reizen (id, org_id) on delete cascade
);
create index on info_blokken (reis_id);

create table berichten (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  reis_id      uuid not null,
  tekst        text not null check (length(tekst) between 1 and 4000),
  belangrijk   boolean not null default false,
  auteur_naam  text not null check (length(auteur_naam) between 1 and 120),
  geplaatst_op timestamptz not null default now(),
  foreign key (reis_id, org_id) references reizen (id, org_id) on delete cascade
);
create index on berichten (reis_id, geplaatst_op desc);

create function zet_bijgewerkt_op() returns trigger language plpgsql as $$
begin
  new.bijgewerkt_op := now();
  return new;
end $$;
create trigger bijgewerkt before update on programma_dagen for each row execute function zet_bijgewerkt_op();
create trigger bijgewerkt before update on programma_onderdelen for each row execute function zet_bijgewerkt_op();
create trigger bijgewerkt before update on info_blokken for each row execute function zet_bijgewerkt_op();

-- ---------------------------------------------------------------------------
-- Wie ben ik? De app zet per transactie app.sessie op de hash van de cookie.
-- Alle rechten worden daaruit afgeleid, in de database.
-- ---------------------------------------------------------------------------

create function mijn_leden() returns setof lidmaatschappen
language sql stable security definer set search_path = public, pg_temp as $$
  select l.*
  from sessies s
  join sessie_toegang t on t.sessie_hash = s.token_hash
  join lidmaatschappen l on l.id = t.lidmaatschap_id
  where s.token_hash = nullif(current_setting('app.sessie', true), '')
    and s.verloopt_op > now()
    and l.ingetrokken_op is null
$$;

create function is_beheerder(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from mijn_leden() m where m.org_id = p_org and m.rol = 'beheerder')
$$;

create function is_lid_van_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from mijn_leden() m where m.org_id = p_org)
$$;

-- Hoogste rol van deze sessie binnen één reis (een toestel kan door meerdere
-- mensen gedeeld worden, bijvoorbeeld een echtpaar met elk een uitnodiging).
create function reis_rol(p_reis uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.rol from mijn_leden() m
  where m.reis_id = p_reis
  order by (m.rol = 'groepsleider') desc
  limit 1
$$;

-- Een gearchiveerde reis is afgesloten: alleen de beheerder kan er nog bij.
create function reis_is_open(p_reis uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from reizen r where r.id = p_reis and not r.gearchiveerd)
$$;

create function mag_reis_lezen(p_reis uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_beheerder(p_org) or (reis_rol(p_reis) is not null and reis_is_open(p_reis))
$$;

create function mag_reis_beheren(p_reis uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_beheerder(p_org) or (coalesce(reis_rol(p_reis) = 'groepsleider', false) and reis_is_open(p_reis))
$$;

-- Beheerders beheren iedereen in hun organisatie. Groepsleiders beheren alleen
-- deelnemers van hun eigen reis; ze kunnen dus geen groepsleiders aanwijzen.
create function mag_lid_beheren(p_org uuid, p_reis uuid, p_rol text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_beheerder(p_org)
      or (p_rol = 'deelnemer' and p_reis is not null
          and coalesce(reis_rol(p_reis) = 'groepsleider', false) and reis_is_open(p_reis))
$$;

create function mijn_naam(p_reis uuid, p_org uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.naam from mijn_leden() m
  where (m.reis_id = p_reis and m.rol = 'groepsleider') or (m.org_id = p_org and m.rol = 'beheerder')
  order by (m.reis_id is not null) desc
  limit 1
$$;

-- Deelnemers zien elkaars gegevens niet, maar wel de namen van hun groepsleiders.
create function reis_groepsleiders(p_reis uuid) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select l.naam
  from lidmaatschappen l
  join reizen r on r.id = l.reis_id
  where l.reis_id = p_reis and l.rol = 'groepsleider' and l.ingetrokken_op is null
    and mag_reis_lezen(r.id, r.org_id)
  order by l.naam
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table organisaties         enable row level security;
alter table reizen               enable row level security;
alter table lidmaatschappen      enable row level security;
alter table sessies              enable row level security;
alter table sessie_toegang       enable row level security;
alter table login_tokens         enable row level security;
alter table programma_dagen      enable row level security;
alter table programma_onderdelen enable row level security;
alter table info_blokken         enable row level security;
alter table berichten            enable row level security;

create policy org_lezen on organisaties for select using (is_lid_van_org(id));

create policy reis_lezen    on reizen for select using (mag_reis_lezen(id, org_id));
create policy reis_aanmaken on reizen for insert with check (is_beheerder(org_id));
create policy reis_wijzigen on reizen for update using (is_beheerder(org_id)) with check (is_beheerder(org_id));

create policy lid_lezen on lidmaatschappen for select using (
  id in (select m.id from mijn_leden() m)
  or is_beheerder(org_id)
  or (reis_id is not null and coalesce(reis_rol(reis_id) = 'groepsleider', false) and reis_is_open(reis_id))
);
create policy lid_aanmaken on lidmaatschappen for insert with check (mag_lid_beheren(org_id, reis_id, rol));
create policy lid_wijzigen on lidmaatschappen for update
  using (mag_lid_beheren(org_id, reis_id, rol)) with check (mag_lid_beheren(org_id, reis_id, rol));
create policy lid_verwijderen on lidmaatschappen for delete
  using (mag_lid_beheren(org_id, reis_id, rol) and geaccepteerd_op is null);

create policy dag_lezen       on programma_dagen for select using (mag_reis_lezen(reis_id, org_id));
create policy dag_aanmaken    on programma_dagen for insert with check (mag_reis_beheren(reis_id, org_id));
create policy dag_wijzigen    on programma_dagen for update using (mag_reis_beheren(reis_id, org_id)) with check (mag_reis_beheren(reis_id, org_id));
create policy dag_verwijderen on programma_dagen for delete using (mag_reis_beheren(reis_id, org_id));

create policy onderdeel_lezen       on programma_onderdelen for select using (mag_reis_lezen(reis_id, org_id));
create policy onderdeel_aanmaken    on programma_onderdelen for insert with check (mag_reis_beheren(reis_id, org_id));
create policy onderdeel_wijzigen    on programma_onderdelen for update using (mag_reis_beheren(reis_id, org_id)) with check (mag_reis_beheren(reis_id, org_id));
create policy onderdeel_verwijderen on programma_onderdelen for delete using (mag_reis_beheren(reis_id, org_id));

create policy info_lezen       on info_blokken for select using (mag_reis_lezen(reis_id, org_id));
create policy info_aanmaken    on info_blokken for insert with check (mag_reis_beheren(reis_id, org_id));
create policy info_wijzigen    on info_blokken for update using (mag_reis_beheren(reis_id, org_id)) with check (mag_reis_beheren(reis_id, org_id));
create policy info_verwijderen on info_blokken for delete using (mag_reis_beheren(reis_id, org_id));

create policy bericht_lezen       on berichten for select using (mag_reis_lezen(reis_id, org_id));
create policy bericht_plaatsen    on berichten for insert with check (mag_reis_beheren(reis_id, org_id));
create policy bericht_verwijderen on berichten for delete using (mag_reis_beheren(reis_id, org_id));

-- sessies, sessie_toegang en login_tokens: RLS aan, geen enkele policy en geen
-- grants. De app-rol kan er dus op geen enkele manier rechtstreeks bij.

-- ---------------------------------------------------------------------------
-- Auth-functies (enige weg naar sessies en inlogcodes)
-- ---------------------------------------------------------------------------

create function auth_sessie(p_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select s.id into v_id from sessies s where s.token_hash = p_hash and s.verloopt_op > now();
  if v_id is null then return null; end if;
  update sessies set laatst_gezien_op = now()
    where token_hash = p_hash and laatst_gezien_op < now() - interval '1 hour';
  return v_id;
end $$;

create function auth_uitnodiging_bekijken(p_hash text)
returns table (naam text, rol text, reis_titel text, organisatie text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.naam, l.rol, r.titel, o.naam,
    case
      when l.ingetrokken_op is not null then 'ingetrokken'
      when l.uitnodiging_gebruikt_op is not null then 'gebruikt'
      when l.uitnodiging_verloopt_op < now() then 'verlopen'
      else 'geldig'
    end
  from lidmaatschappen l
  join organisaties o on o.id = l.org_id
  left join reizen r on r.id = l.reis_id
  where l.uitnodiging_hash = p_hash
$$;

-- Hulpfunctie: gebruik de bestaande sessie van dit toestel als die nog geldig
-- is, maak anders een nieuwe. Geeft de hash van de te gebruiken sessie terug.
create function auth_sessie_kiezen(p_bestaand text, p_nieuw text, p_verloopt timestamptz) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_bestaand is not null and exists (
    select 1 from sessies where token_hash = p_bestaand and verloopt_op > now()
  ) then
    return p_bestaand;
  end if;
  insert into sessies (token_hash, verloopt_op) values (p_nieuw, p_verloopt);
  return p_nieuw;
end $$;

-- Eenmalig: de link geeft toegang tot precies dit ene lidmaatschap.
create function auth_uitnodiging_accepteren(p_hash text, p_bestaand text, p_nieuw text, p_verloopt timestamptz)
returns table (uitkomst text, reis_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare l lidmaatschappen; v_sessie text;
begin
  select * into l from lidmaatschappen where uitnodiging_hash = p_hash for update;
  if not found or l.ingetrokken_op is not null or l.uitnodiging_gebruikt_op is not null
     or l.uitnodiging_verloopt_op is null or l.uitnodiging_verloopt_op < now() then
    return;
  end if;
  v_sessie := auth_sessie_kiezen(p_bestaand, p_nieuw, p_verloopt);
  insert into sessie_toegang (sessie_hash, lidmaatschap_id) values (v_sessie, l.id) on conflict do nothing;
  update lidmaatschappen
    set uitnodiging_gebruikt_op = now(), geaccepteerd_op = coalesce(geaccepteerd_op, now())
    where id = l.id;
  uitkomst := case when v_sessie = p_bestaand then 'bestaand' else 'nieuw' end;
  reis_id := l.reis_id;
  return next;
end $$;

-- Geeft true als er voor dit adres iets te openen valt. De app antwoordt naar
-- buiten altijd hetzelfde, zodat niemand kan uitvissen wie deelnemer is.
create function auth_login_aanvragen(p_email text, p_token_hash text, p_code_hash text, p_verloopt timestamptz)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from lidmaatschappen where email = p_email and ingetrokken_op is null) then
    return false;
  end if;
  delete from login_tokens where email = p_email;
  insert into login_tokens (email, token_hash, code_hash, verloopt_op)
    values (p_email, p_token_hash, p_code_hash, p_verloopt);
  return true;
end $$;

-- Inloggen met de link (p_token_hash) of de code (p_email + p_code_hash) uit de
-- mail. Wie zo inlogt heeft bewezen het e-mailadres te beheren en krijgt alle
-- lidmaatschappen van dat adres. Maximaal 5 pogingen per code.
create function auth_login_voltooien(p_email text, p_code_hash text, p_token_hash text,
                                     p_bestaand text, p_nieuw text, p_verloopt timestamptz)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t login_tokens; v_sessie text;
begin
  if p_token_hash is not null then
    select * into t from login_tokens
      where token_hash = p_token_hash and gebruikt_op is null and verloopt_op > now()
      for update;
    if not found then return null; end if;
  else
    select * into t from login_tokens
      where email = p_email and gebruikt_op is null and verloopt_op > now()
      order by aangemaakt_op desc limit 1
      for update;
    if not found or t.pogingen >= 5 then return null; end if;
    if t.code_hash <> p_code_hash then
      update login_tokens set pogingen = pogingen + 1 where id = t.id;
      return null;
    end if;
  end if;

  update login_tokens set gebruikt_op = now() where id = t.id;
  v_sessie := auth_sessie_kiezen(p_bestaand, p_nieuw, p_verloopt);
  insert into sessie_toegang (sessie_hash, lidmaatschap_id)
    select v_sessie, l.id from lidmaatschappen l
    where l.email = t.email and l.ingetrokken_op is null
    on conflict do nothing;
  update lidmaatschappen set geaccepteerd_op = now()
    where email = t.email and ingetrokken_op is null and geaccepteerd_op is null;
  return case when v_sessie = p_bestaand then 'bestaand' else 'nieuw' end;
end $$;

create function auth_uitloggen(p_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from sessies where token_hash = p_hash
$$;

-- Toegang intrekken werkt direct, op alle toestellen van die persoon.
create function lid_intrekken(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare l lidmaatschappen;
begin
  select * into l from lidmaatschappen where id = p_id for update;
  if not found or not mag_lid_beheren(l.org_id, l.reis_id, l.rol) then return false; end if;
  if exists (select 1 from mijn_leden() m where m.id = p_id) then return false; end if;
  update lidmaatschappen set ingetrokken_op = now(), uitnodiging_hash = null where id = p_id;
  delete from sessie_toegang where lidmaatschap_id = p_id;
  return true;
end $$;

-- Nieuwe link (ook bij verloren telefoon): alle bestaande toegang voor dit
-- lidmaatschap vervalt, de nieuwe link is weer eenmalig.
create function lid_nieuwe_link(p_id uuid, p_hash text, p_verloopt timestamptz) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare l lidmaatschappen;
begin
  select * into l from lidmaatschappen where id = p_id for update;
  if not found or not mag_lid_beheren(l.org_id, l.reis_id, l.rol) then return false; end if;
  if exists (select 1 from mijn_leden() m where m.id = p_id) then return false; end if;
  update lidmaatschappen
    set uitnodiging_hash = p_hash, uitnodiging_verloopt_op = p_verloopt,
        uitnodiging_gebruikt_op = null, ingetrokken_op = null
    where id = p_id;
  delete from sessie_toegang where lidmaatschap_id = p_id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Rechten van de app-rol: zo krap mogelijk, per kolom waar dat ertoe doet.
-- ---------------------------------------------------------------------------

revoke all on schema public from public;
grant usage on schema public to reisapp_app;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to reisapp_app;

grant select on organisaties to reisapp_app;

grant select on reizen to reisapp_app;
grant insert (org_id, titel, ondertitel, start_datum, eind_datum) on reizen to reisapp_app;
grant update (titel, ondertitel, start_datum, eind_datum, gearchiveerd) on reizen to reisapp_app;

grant select, delete on lidmaatschappen to reisapp_app;
grant insert (org_id, reis_id, rol, email, naam, uitnodiging_hash, uitnodiging_verloopt_op) on lidmaatschappen to reisapp_app;
grant update (naam) on lidmaatschappen to reisapp_app;

grant select, delete on programma_dagen to reisapp_app;
grant insert (org_id, reis_id, datum, titel, ondertitel, toelichting) on programma_dagen to reisapp_app;
grant update (datum, titel, ondertitel, toelichting) on programma_dagen to reisapp_app;

grant select, delete on programma_onderdelen to reisapp_app;
grant insert (org_id, reis_id, dag_id, begin_tijd, eind_tijd, titel, omschrijving, verzameltijd, verzamelpunt, meenemen, facultatief) on programma_onderdelen to reisapp_app;
grant update (begin_tijd, eind_tijd, titel, omschrijving, verzameltijd, verzamelpunt, meenemen, facultatief) on programma_onderdelen to reisapp_app;

grant select, delete on info_blokken to reisapp_app;
grant insert (org_id, reis_id, titel, tekst, volgorde) on info_blokken to reisapp_app;
grant update (titel, tekst, volgorde) on info_blokken to reisapp_app;

grant select, delete on berichten to reisapp_app;
grant insert (org_id, reis_id, tekst, belangrijk, auteur_naam) on berichten to reisapp_app;

-- Eigen foto's van de reisleiding: als omslag van de reis, bij een dag, bij een
-- programma-onderdeel (bijvoorbeeld het verzamelpunt) en bij een bericht.
--
-- De foto's staan in de database zelf. Daardoor gelden dezelfde toegangsregels
-- als voor de rest van de reis en is er geen aparte opslagdienst nodig. De app
-- verkleint elke foto voor het versturen; de database weigert alles boven 700 kB.

create table afbeeldingen (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  reis_id       uuid not null,
  soort         text not null check (soort in ('image/jpeg', 'image/png', 'image/webp')),
  gegevens      bytea not null check (octet_length(gegevens) between 50 and 700000),
  aangemaakt_op timestamptz not null default now(),
  foreign key (reis_id, org_id) references reizen (id, org_id) on delete cascade,
  unique (id, reis_id)
);
create index on afbeeldingen (reis_id);

alter table afbeeldingen enable row level security;
create policy afbeelding_lezen       on afbeeldingen for select using (mag_reis_lezen(reis_id, org_id));
create policy afbeelding_toevoegen   on afbeeldingen for insert with check (mag_reis_beheren(reis_id, org_id));
create policy afbeelding_verwijderen on afbeeldingen for delete using (mag_reis_beheren(reis_id, org_id));

grant select, delete on afbeeldingen to reisapp_app;
grant insert (org_id, reis_id, soort, gegevens) on afbeeldingen to reisapp_app;

-- Een foto kan alleen gekoppeld worden aan iets van DEZELFDE reis: de
-- verwijzing loopt over (foto, reis). Verdwijnt de foto, dan blijft de rest staan.
alter table reizen add column omslag_afbeelding_id uuid,
  add foreign key (omslag_afbeelding_id, id) references afbeeldingen (id, reis_id) on delete set null (omslag_afbeelding_id);
alter table programma_dagen add column afbeelding_id uuid,
  add foreign key (afbeelding_id, reis_id) references afbeeldingen (id, reis_id) on delete set null (afbeelding_id);
alter table programma_onderdelen add column afbeelding_id uuid,
  add foreign key (afbeelding_id, reis_id) references afbeeldingen (id, reis_id) on delete set null (afbeelding_id);
alter table berichten add column afbeelding_id uuid,
  add foreign key (afbeelding_id, reis_id) references afbeeldingen (id, reis_id) on delete set null (afbeelding_id);

grant update (omslag_afbeelding_id) on reizen to reisapp_app;
grant insert (afbeelding_id), update (afbeelding_id) on programma_dagen to reisapp_app;
grant insert (afbeelding_id), update (afbeelding_id) on programma_onderdelen to reisapp_app;
grant insert (afbeelding_id) on berichten to reisapp_app;

-- Een afgesloten reis kan door de beheerder definitief worden verwijderd, met
-- alles erin (programma, berichten, foto's, deelnemers). Eerst afsluiten, dan
-- verwijderen: zo gebeurt het nooit per ongeluk.
create policy reis_verwijderen on reizen for delete using (is_beheerder(org_id) and gearchiveerd);
grant delete on reizen to reisapp_app;

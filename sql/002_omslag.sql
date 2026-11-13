-- Sfeerbeeld per reis. De beheerder kiest uit een vaste set beelden die met de
-- app worden meegeleverd; er worden geen eigen foto's geupload.

alter table reizen add column omslag text not null default 'zee'
  check (omslag in ('zee', 'fjorden', 'rivier', 'stad', 'landschap'));

grant insert (omslag), update (omslag) on reizen to reisapp_app;

-- De uitnodiging toont het beeld van de reis waarvoor je wordt uitgenodigd.
drop function auth_uitnodiging_bekijken(text);
create function auth_uitnodiging_bekijken(p_hash text)
returns table (naam text, rol text, reis_titel text, organisatie text, status text, omslag text)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.naam, l.rol, r.titel, o.naam,
    case
      when l.ingetrokken_op is not null then 'ingetrokken'
      when l.uitnodiging_gebruikt_op is not null then 'gebruikt'
      when l.uitnodiging_verloopt_op < now() then 'verlopen'
      else 'geldig'
    end,
    coalesce(r.omslag, 'zee')
  from lidmaatschappen l
  join organisaties o on o.id = l.org_id
  left join reizen r on r.id = l.reis_id
  where l.uitnodiging_hash = p_hash
$$;
revoke execute on function auth_uitnodiging_bekijken(text) from public;
grant execute on function auth_uitnodiging_bekijken(text) to reisapp_app;

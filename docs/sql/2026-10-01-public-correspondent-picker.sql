-- Public writing only. Private composers no longer mount the picker.
begin;
create or replace function public.correspondent_picker_page(p_search text default '', p_limit integer default 21, p_offset integer default 0)
returns table(user_id uuid, pseudonym text, mark_id uuid)
language sql stable security invoker set search_path to 'pg_catalog'
as $fn$
  with partners as (
    select c.id, case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    where c.status = 'active' and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and not exists (select 1 from public.correspondence_hidden_for_user h where h.user_id=auth.uid() and h.correspondence_id=c.id)
  ), eligible as materialized (
    select p.id, p.pseudonym, p.mark_id, c.id as correspondence_id
    from partners c join public.public_profiles p on p.id = c.user_id
    where public.can_pick_correspondent(p.id)
      and (nullif(btrim(p_search), '') is null or position(lower(btrim(p_search)) in lower(p.pseudonym)) > 0)
  )
  select e.id, e.pseudonym, e.mark_id
  from eligible e join public.letters_for_participant l on l.correspondence_id = e.correspondence_id
  group by e.id, e.pseudonym, e.mark_id
  order by count(l.id) desc, max(l.created_at) desc, e.pseudonym, e.id
  limit least(greatest(coalesce(p_limit, 21), 1), 21)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000)
$fn$;
revoke all on function public.correspondent_picker_page(text,integer,integer) from public, anon;
grant execute on function public.correspondent_picker_page(text,integer,integer) to authenticated;
commit;

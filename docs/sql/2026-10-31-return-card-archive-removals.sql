begin;
create table if not exists public.return_card_archive_removals (
  user_id uuid not null references auth.users(id) on delete cascade,
  return_card_id uuid not null references public.return_cards(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (user_id, return_card_id)
);
alter table public.return_card_archive_removals enable row level security;
create policy return_card_archive_removals_select_own on public.return_card_archive_removals
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.return_card_archive_removals from public, anon, authenticated;
grant select on public.return_card_archive_removals to authenticated;
create or replace function public.remove_my_archive_return_cards(p_card_ids uuid[])
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_user uuid := auth.uid();
  v_requested integer;
  v_allowed integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_card_ids is null or cardinality(p_card_ids)=0 or cardinality(p_card_ids)>200 then
    raise exception 'Choose between 1 and 200 Return Cards' using errcode='22023';
  end if;
  select count(distinct x.id) into v_requested from unnest(p_card_ids) as x(id);
  select count(*) into v_allowed from public.return_cards r
    where r.id = any(p_card_ids) and (r.sender_id=v_user or r.recipient_id=v_user);
  if v_requested <> v_allowed then
    raise exception 'One or more Return Cards are unavailable' using errcode='42501';
  end if;
  insert into public.return_card_archive_removals(user_id, return_card_id)
    select v_user, x.id from (select distinct id from unnest(p_card_ids) as id) x
    on conflict (user_id, return_card_id) do nothing;
end;
$$;
revoke all on function public.remove_my_archive_return_cards(uuid[]) from public, anon;
grant execute on function public.remove_my_archive_return_cards(uuid[]) to authenticated;
commit;

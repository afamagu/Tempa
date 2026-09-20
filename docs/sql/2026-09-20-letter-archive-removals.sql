begin;

create table if not exists public.letter_archive_removals (
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id uuid not null references public.letters(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (user_id, letter_id)
);

alter table public.letter_archive_removals enable row level security;

drop policy if exists letter_archive_removals_select_own on public.letter_archive_removals;
create policy letter_archive_removals_select_own
  on public.letter_archive_removals for select to authenticated
  using (user_id = auth.uid());

revoke all on public.letter_archive_removals from public, anon, authenticated;
grant select on public.letter_archive_removals to authenticated;

create or replace function public.remove_my_archive_letters(p_letter_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_requested_count integer;
  v_allowed_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_letter_ids is null or cardinality(p_letter_ids) = 0 then raise exception 'Choose at least one letter'; end if;

  select count(distinct id) into v_requested_count from unnest(p_letter_ids) as id;
  select count(*) into v_allowed_count
  from public.letters l
  where l.id = any(p_letter_ids)
    and (l.sender_id = v_user_id or l.recipient_id = v_user_id);

  if v_allowed_count <> v_requested_count then
    raise exception 'One or more letters are unavailable';
  end if;

  insert into public.letter_archive_removals (user_id, letter_id)
  select v_user_id, id from unnest(p_letter_ids) as id
  on conflict (user_id, letter_id) do nothing;
end;
$$;

revoke all on function public.remove_my_archive_letters(uuid[]) from public, anon;
grant execute on function public.remove_my_archive_letters(uuid[]) to authenticated;

commit;

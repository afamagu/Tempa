-- Allow blank postcard notes and an explicit, self-scoped introduction deferral.
-- Preserve installed function bodies, ownership, Safety checks and grants.
begin;

alter table public.letter_postcards drop constraint letter_postcards_back_message_length;
alter table public.letter_postcards add constraint letter_postcards_back_message_length
  check (char_length(trim(both from back_message)) between 0 and 300);
alter table public.dispatch_postcards drop constraint dispatch_postcards_back_message_length;
alter table public.dispatch_postcards add constraint dispatch_postcards_back_message_length
  check (char_length(trim(both from back_message)) between 0 and 300);

do $migration$
declare
  f record;
  definition text;
  matched integer := 0;
  blank_guard text := 'if v_back_message is null or char_length\(trim\(both from v_back_message\)\) = 0 then[[:space:]]+(raise exception ''A Postcard needs its own written message before it can be (sent|published)\.'';|return false;)[[:space:]]+end if;';
begin
  for f in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in (
      'write_letter', 'reply_to_letter', 'publish_dispatch', 'publish_official_dispatch'
    )) or (n.nspname = 'tempa_private' and p.proname = 'postcard_shape_is_valid')
  loop
    definition := pg_get_functiondef(f.oid);
    if position('v_back_message' in definition) = 0 then continue; end if;
    matched := matched + 1;
    definition := replace(definition,
      'v_back_message := p_postcard->>''back_message'';',
      'v_back_message := coalesce(p_postcard->>''back_message'', '''');');
    definition := regexp_replace(definition, blank_guard, '', 'g');
    if position('coalesce(p_postcard->>''back_message'', '''')' in definition) = 0
       or definition like '%A Postcard needs its own written message%'
       or definition ~ 'if v_back_message is null or char_length\(trim\(both from v_back_message\)\) = 0' then
      raise exception 'Unexpected postcard validation in %.%; nothing applied.', f.nspname, f.proname;
    end if;
    execute definition;
  end loop;
  if matched <> 5 then
    raise exception 'Expected five installed postcard validators, found %; nothing applied.', matched;
  end if;
end;
$migration$;

create or replace function public.defer_flagship_onboarding()
returns void language plpgsql security definer set search_path = 'pg_catalog'
as $function$
declare v_stage text;
begin
  if auth.uid() is null or tempa_private.account_is_banned(auth.uid()) then
    raise exception 'Member access required.' using errcode = '42501';
  end if;
  select p.onboarding_stage into v_stage from public.profiles p
  where p.id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if v_stage = 'complete' then return; end if;
  if v_stage <> 'question' then raise exception 'Complete Your Mark first.'; end if;
  update public.profiles set onboarding_stage = 'complete' where id = auth.uid();
  -- No answer is fabricated, and no other member's profile can be changed.
end;
$function$;
revoke all on function public.defer_flagship_onboarding() from public, anon;
grant execute on function public.defer_flagship_onboarding() to authenticated;

commit;

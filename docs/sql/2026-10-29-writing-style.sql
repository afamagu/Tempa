-- TEMPA — WRITING STYLE
-- STATUS: NOT YET APPLIED. Prepared for review; run in the Supabase SQL editor
-- only after approval. Depends on 2026-10-16-account-lifecycle.sql (the
-- current current_account_entry_state), 2026-10-15-official-sponsored-
-- dispatches.sql (dispatches.published_as) and 2026-10-27-public-dispatch-
-- web-pages.sql (tempa_private.dispatch_is_web_public). Verifier:
-- 2026-10-29-writing-style-verify.sql.
--
-- A member chooses how their authored prose appears. Only a stable
-- SEMANTIC id is stored — ink | notebook | freehand | literary |
-- correspondence | typewriter — never a font name or any CSS. The app's
-- registry (lib/writing-style.ts) maps the id to typography, so a face can
-- later be tuned or replaced without touching a row.
--
--   1. profiles.writing_style_id — nullable. NO default and NO backfill:
--      existing members are never assigned an identity; the app asks
--      each of them once. New profiles always start with none.
--   2. set_my_writing_style(text) — the one write path (direct profile
--      UPDATE stays revoked; see 2026-09-29-your-mark-production.sql).
--   3. letters.author_writing_style_id — snapshotted by trigger at send
--      time from the sender's profile, whatever RPC inserted the row, and
--      frozen afterwards (an edit never restyles a sent letter). Letters
--      sent before this migration stay null = Tempa's classic prose.
--   4. dispatches.author_writing_style_id — same rule, for member
--      Dispatches (official/sponsored Dispatches speak in Tempa's voice).
--   5. Narrow read paths — the style ids a caller is already allowed to
--      see, without widening public_profiles or letters_for_participant
--      (whose row type several send RPCs return).
--   6. current_account_entry_state gains has_writing_style so proxy.ts can
--      offer the one-time choice without another round trip.

begin;

-- ------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists writing_style_id text;

alter table public.profiles
  drop constraint if exists profiles_writing_style_id_valid;

alter table public.profiles
  add constraint profiles_writing_style_id_valid
  check (
    writing_style_id is null
    or writing_style_id in ('ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter')
  );

comment on column public.profiles.writing_style_id is
  'Semantic Writing Style id chosen by the member (lib/writing-style.ts). Null = not chosen yet; rendered in Tempa''s canonical prose.';

-- Every new profile starts without a style, whatever the insert supplied —
-- the member makes this choice themselves after the Flagship Question.
create or replace function tempa_private.force_initial_profile_writing_style()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  new.writing_style_id := null;
  return new;
end;
$function$;

revoke all on function tempa_private.force_initial_profile_writing_style()
  from public, anon, authenticated;

drop trigger if exists profiles_force_initial_writing_style on public.profiles;
create trigger profiles_force_initial_writing_style
before insert on public.profiles
for each row execute function tempa_private.force_initial_profile_writing_style();

-- ------------------------------------------------------------
-- 2. THE ONE WRITE PATH
-- ------------------------------------------------------------
create or replace function public.set_my_writing_style(p_style_id text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_stage text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_style_id is null
     or p_style_id not in ('ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter') then
    raise exception 'Unknown writing style.' using errcode = '22023';
  end if;

  select p.onboarding_stage into v_stage
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if not found then
    raise exception 'Create your profile first.';
  end if;

  -- Chosen after the Flagship Question; never a way around Mark/Question.
  if v_stage <> 'complete' then
    raise exception 'Finish the earlier onboarding steps first.';
  end if;

  update public.profiles
  set writing_style_id = p_style_id
  where id = auth.uid();

  return p_style_id;
end;
$function$;

revoke all on function public.set_my_writing_style(text) from public, anon;
grant execute on function public.set_my_writing_style(text) to authenticated;

-- ------------------------------------------------------------
-- 3. LETTERS — send-time snapshot
-- ------------------------------------------------------------
alter table public.letters
  add column if not exists author_writing_style_id text;

alter table public.letters
  drop constraint if exists letters_author_writing_style_id_valid;

alter table public.letters
  add constraint letters_author_writing_style_id_valid
  check (
    author_writing_style_id is null
    or author_writing_style_id in ('ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter')
  );

comment on column public.letters.author_writing_style_id is
  'Sender''s Writing Style at send time (trigger-set, immutable). Null = sent before Writing Styles; rendered in Tempa''s classic prose.';

create or replace function tempa_private.snapshot_letter_writing_style()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    -- Never trust a caller-supplied value: the snapshot is the sender's
    -- profile at this instant.
    new.author_writing_style_id := (
      select p.writing_style_id from public.profiles p where p.id = new.sender_id
    );
  else
    new.author_writing_style_id := old.author_writing_style_id;
  end if;
  return new;
end;
$function$;

revoke all on function tempa_private.snapshot_letter_writing_style()
  from public, anon, authenticated;

drop trigger if exists letters_snapshot_writing_style on public.letters;
create trigger letters_snapshot_writing_style
before insert or update of author_writing_style_id on public.letters
for each row execute function tempa_private.snapshot_letter_writing_style();

-- ------------------------------------------------------------
-- 4. DISPATCHES — publish-time snapshot
-- ------------------------------------------------------------
alter table public.dispatches
  add column if not exists author_writing_style_id text;

alter table public.dispatches
  drop constraint if exists dispatches_author_writing_style_id_valid;

alter table public.dispatches
  add constraint dispatches_author_writing_style_id_valid
  check (
    author_writing_style_id is null
    or author_writing_style_id in ('ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter')
  );

comment on column public.dispatches.author_writing_style_id is
  'Author''s Writing Style when the Dispatch was published (trigger-set, immutable). Null = published before Writing Styles, or an official/sponsored Dispatch.';

create or replace function tempa_private.snapshot_dispatch_writing_style()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.published_as, 'member') = 'member' then
      new.author_writing_style_id := (
        select p.writing_style_id from public.profiles p where p.id = new.author_id
      );
    else
      new.author_writing_style_id := null;
    end if;
  else
    new.author_writing_style_id := old.author_writing_style_id;
  end if;
  return new;
end;
$function$;

revoke all on function tempa_private.snapshot_dispatch_writing_style()
  from public, anon, authenticated;

drop trigger if exists dispatches_snapshot_writing_style on public.dispatches;
create trigger dispatches_snapshot_writing_style
before insert or update of author_writing_style_id on public.dispatches
for each row execute function tempa_private.snapshot_dispatch_writing_style();

-- ------------------------------------------------------------
-- 5. READ PATHS (ids only — never text, never other profile fields)
-- ------------------------------------------------------------

-- Current style of members the caller can already see (public_profiles
-- carries every block/ban/break rule; auth.uid() inside the view is still
-- the caller). Bounded to 200 ids per call.
create or replace function public.member_writing_styles(p_user_ids uuid[])
returns table (user_id uuid, writing_style_id text)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select p.id, p.writing_style_id
  from public.profiles p
  where p.id = any (p_user_ids[1:200])
    and p.writing_style_id is not null
    and exists (select 1 from public.public_profiles pp where pp.id = p.id)
$function$;

revoke all on function public.member_writing_styles(uuid[]) from public, anon;
grant execute on function public.member_writing_styles(uuid[]) to authenticated;

-- The send-time snapshot of letters the caller can already read
-- (letters_for_participant: sender always, recipient once delivered).
create or replace function public.letter_writing_styles(p_letter_ids uuid[])
returns table (letter_id uuid, author_writing_style_id text)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select l.id, l.author_writing_style_id
  from public.letters l
  where l.id = any (p_letter_ids[1:200])
    and l.author_writing_style_id is not null
    and exists (select 1 from public.letters_for_participant v where v.id = l.id)
$function$;

revoke all on function public.letter_writing_styles(uuid[]) from public, anon;
grant execute on function public.letter_writing_styles(uuid[]) to authenticated;

-- A shared Dispatch's style — exactly get_shared_dispatch's own
-- visibility rule, returning only the semantic id.
create or replace function public.shared_dispatch_writing_style(p_token uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select d.author_writing_style_id
  from public.dispatch_shares ds
  join public.dispatches d on d.id = ds.dispatch_id
  where ds.id = p_token
    and ds.revoked_at is null
    and d.status = 'published'
    and d.moderation_status = 'visible'
    and (d.published_as <> 'member' or tempa_private.author_content_publicly_visible(d.author_id))
$function$;

revoke all on function public.shared_dispatch_writing_style(uuid) from public, anon, authenticated;
grant execute on function public.shared_dispatch_writing_style(uuid) to anon, authenticated;

-- A public-on-the-web Dispatch's style — the one web-visibility predicate.
create or replace function public.public_dispatch_writing_style(p_slug text)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select d.author_writing_style_id
  from public.dispatches d
  where d.web_slug = p_slug
    and tempa_private.dispatch_is_web_public(d.id)
$function$;

revoke all on function public.public_dispatch_writing_style(text) from public, anon, authenticated;
grant execute on function public.public_dispatch_writing_style(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 6. ACCOUNT ENTRY — has_writing_style
-- ------------------------------------------------------------
-- The return type changes, so the function is dropped and recreated in
-- this same transaction. Body otherwise identical to
-- 2026-10-16-account-lifecycle.sql. An app deployed before this migration
-- simply never sees the new column (no gate); an app deployed after reads
-- it (lib/account-entry-state.ts).
drop function if exists public.current_account_entry_state(text, text);

create function public.current_account_entry_state(
  p_terms_version text,
  p_guidelines_version text
)
returns table (
  account_status text,
  eligibility_status text,
  has_profile boolean,
  onboarding_stage text,
  terms_current boolean,
  guidelines_current boolean,
  has_writing_style boolean
)
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  select
    case public.my_account_lifecycle()
      when 'closed' then 'closed'
      when 'deactivated' then 'deactivated'
      else public.current_account_status()
    end as account_status,
    (
      select e.status
      from public.account_eligibility e
      where e.user_id = auth.uid()
    ) as eligibility_status,
    exists (
      select 1 from public.profiles p where p.id = auth.uid()
    ) as has_profile,
    (
      select p.onboarding_stage::text
      from public.profiles p
      where p.id = auth.uid()
    ) as onboarding_stage,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'terms_of_service'
        and la.document_version = p_terms_version
    ) as terms_current,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'community_guidelines'
        and la.document_version = p_guidelines_version
    ) as guidelines_current,
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.writing_style_id is not null
    ) as has_writing_style
  where auth.uid() is not null
$function$;

revoke all on function public.current_account_entry_state(text, text) from public, anon;
grant execute on function public.current_account_entry_state(text, text) to authenticated;

commit;

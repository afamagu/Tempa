-- ============================================================
-- FIX — letter_photos_select missing an explicit `to authenticated`
-- scope (External Dispatch Moment live diagnostic, 2026-09-10)
-- ============================================================
-- NOT EXECUTED BY THE ASSISTANT. Prepared for you to paste and run in
-- the Supabase SQL editor. This is the proven, minimal fix for the
-- external Dispatch Moment bug — found by a live end-to-end trace
-- against a real shared Dispatch with a real Moment, not a guess.
--
-- ROOT CAUSE (proven, not inferred):
-- getSharedDispatch()'s call to
-- supabase.storage.from('dispatch-photos').createSignedUrls(...) — a
-- completely correct call, with the completely correct paths, as an
-- anonymous (anon) caller — failed with:
--
--   { message: 'permission denied for function can_view_letter_photo',
--     name: 'StorageApiError', status: 400 }
--
-- can_view_letter_photo (docs/sql/2026-08-31-first-photo-consent.sql)
-- is a PRIVATE-LETTER-photo function, wholly unrelated to Dispatches —
-- EXECUTE-granted to `authenticated` only, never `anon`. The policy
-- that calls it, letter_photos_select, was created with no explicit
-- `to` clause, defaulting to role PUBLIC — so it is one of the
-- policies Postgres includes when evaluating ANY role's (including
-- anon's) SELECT against storage.objects, for every row, regardless of
-- bucket_id. Because RLS-protected relations are wrapped as
-- security-barrier views, `bucket_id = 'letter-photos' and
-- can_view_letter_photo(name)` is not guaranteed to short-circuit past
-- the bucket_id check for a dispatch-photos row — Postgres attempts to
-- evaluate can_view_letter_photo(name) regardless, anon has no EXECUTE
-- privilege on it at all, and the entire storage.objects RLS check
-- errors out for anon, for every bucket, not just letter-photos. This
-- is the exact same class of gap already found and fixed for
-- dispatch_photos_insert/dispatch_photos_select in the Board usability
-- checkpoint (2026-09-08) — this one pre-existing policy, from an
-- earlier migration, was simply never touched by that pass, because
-- nothing had yet exercised an anon request against storage.objects at
-- all until Dispatch sharing shipped.
--
-- THE FIX is a pure narrowing, not a capability change: `authenticated`
-- callers already satisfy the implicit PUBLIC scope today, so scoping
-- this policy to `authenticated` explicitly changes nothing about who
-- can read a letter photo or how can_view_letter_photo's own logic
-- evaluates — it only removes `anon` from a policy anon was never
-- meant to be covered by, was never able to pass anyway (no EXECUTE
-- grant), and whose mere presence in anon's RLS evaluation is what
-- broke completely unrelated anon storage reads. Private-letter photo
-- consent/visibility logic, can_view_letter_photo itself, both storage
-- buckets' public/private state, and every Dispatch-specific storage
-- policy are all left completely untouched — verified explicitly below,
-- both before and after the change, inside the same transaction.
--
-- The whole block aborts (RAISE EXCEPTION → transaction rolled back,
-- nothing committed) if the live policy doesn't match what was traced,
-- or if any post-change invariant doesn't hold.

begin;

-- ------------------------------------------------------------
-- PRE-MUTATION CHECK — refuse to touch anything unless the live
-- policy is exactly the one this fix was designed for.
-- ------------------------------------------------------------
do $pre_check$
declare
  r record;
begin
  select *
  into r
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'letter_photos_select';

  if not found then
    raise exception 'ABORT: no policy named letter_photos_select exists on storage.objects — refusing to proceed blind';
  end if;

  if r.cmd is distinct from 'SELECT' then
    raise exception 'ABORT: letter_photos_select is not a SELECT policy (cmd = %) — refusing to proceed', r.cmd;
  end if;

  if r.qual is null or r.qual !~* 'bucket_id\s*=\s*''letter-photos''' then
    raise exception 'ABORT: letter_photos_select USING expression does not reference bucket_id = ''letter-photos'' (got: %) — refusing to overwrite an unexpected policy', coalesce(r.qual, '(null)');
  end if;

  if r.qual !~* 'can_view_letter_photo\s*\(\s*name\s*\)' then
    raise exception 'ABORT: letter_photos_select USING expression does not call can_view_letter_photo(name) (got: %) — refusing to overwrite an unexpected policy', coalesce(r.qual, '(null)');
  end if;

  raise notice 'PRE-CHECK PASSED: letter_photos_select matches the expected private-letter expression (qual = %)', r.qual;
end
$pre_check$;

-- ------------------------------------------------------------
-- THE FIX — drop and recreate ONLY this one policy, scoped to
-- authenticated, USING expression byte-for-byte unchanged.
-- ------------------------------------------------------------
drop policy letter_photos_select on storage.objects;

create policy letter_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'letter-photos'
    and public.can_view_letter_photo(name)
  );

-- ------------------------------------------------------------
-- POST-MUTATION CHECK — every invariant that must still hold before
-- this is allowed to commit.
-- ------------------------------------------------------------
do $post_check$
declare
  r record;
  v_anon_can_exec boolean;
  v_dispatch_policy_count int;
  v_dispatch_bucket_public boolean;
  v_letter_bucket_public boolean;
begin
  -- letter_photos_select exists, is SELECT-only, scoped to
  -- authenticated only, and its expression still contains both the
  -- bucket check and the can_view_letter_photo call.
  select *
  into r
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'letter_photos_select';

  if not found then
    raise exception 'ABORT: letter_photos_select is missing after recreate';
  end if;

  if r.cmd is distinct from 'SELECT' then
    raise exception 'ABORT: recreated letter_photos_select cmd = % , expected SELECT', r.cmd;
  end if;

  if r.roles is distinct from array['authenticated']::name[] then
    raise exception 'ABORT: recreated letter_photos_select roles = % , expected {authenticated} only', r.roles;
  end if;

  if r.qual is null or r.qual !~* 'bucket_id\s*=\s*''letter-photos''' then
    raise exception 'ABORT: recreated letter_photos_select no longer references bucket_id = ''letter-photos'' (got: %)', coalesce(r.qual, '(null)');
  end if;

  if r.qual !~* 'can_view_letter_photo\s*\(\s*name\s*\)' then
    raise exception 'ABORT: recreated letter_photos_select no longer calls can_view_letter_photo(name) (got: %)', coalesce(r.qual, '(null)');
  end if;

  -- can_view_letter_photo must remain NOT executable by anon —
  -- this fix must never widen that.
  select has_function_privilege('anon', 'public.can_view_letter_photo(text)', 'EXECUTE')
  into v_anon_can_exec;

  if v_anon_can_exec then
    raise exception 'ABORT: anon can EXECUTE can_view_letter_photo — this must remain false; refusing to commit';
  end if;

  -- The Dispatch external-sharing storage path must be completely
  -- untouched by this change.
  select count(*)
  into v_dispatch_policy_count
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'dispatch_photos_select_shared';

  if v_dispatch_policy_count = 0 then
    raise exception 'ABORT: dispatch_photos_select_shared policy is missing — refusing to commit';
  end if;

  -- Both buckets must remain private.
  select public into v_dispatch_bucket_public from storage.buckets where id = 'dispatch-photos';
  if v_dispatch_bucket_public is distinct from false then
    raise exception 'ABORT: dispatch-photos bucket is not private (public = %)', v_dispatch_bucket_public;
  end if;

  select public into v_letter_bucket_public from storage.buckets where id = 'letter-photos';
  if v_letter_bucket_public is distinct from false then
    raise exception 'ABORT: letter-photos bucket is not private (public = %)', v_letter_bucket_public;
  end if;

  raise notice 'POST-CHECK PASSED: letter_photos_select is now authenticated-only; can_view_letter_photo, dispatch_photos_select_shared, and both bucket privacy settings are all unchanged';
end
$post_check$;

commit;

-- ============================================================
-- FINAL READ-ONLY SUMMARY — run after the block above commits
-- ============================================================
select
  case
    when exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'letter_photos_select'
        and cmd = 'SELECT' and roles = array['authenticated']::name[]
    ) then '[OK]' else '[BUG]'
  end as letter_photo_policy_scoped,
  case
    when not has_function_privilege('anon', 'public.can_view_letter_photo(text)', 'EXECUTE')
    then '[OK]' else '[BUG]'
  end as anon_still_cannot_execute_private_letter_function,
  case
    when exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'dispatch_photos_select_shared'
    ) then '[OK]' else '[BUG]'
  end as dispatch_shared_photo_policy_intact,
  case
    when (select public from storage.buckets where id = 'dispatch-photos') = false
    then '[OK]' else '[BUG]'
  end as dispatch_photos_private,
  case
    when (select public from storage.buckets where id = 'letter-photos') = false
    then '[OK]' else '[BUG]'
  end as letter_photos_private;

-- ============================================================
-- Live-test step after this fix is applied
-- ============================================================
-- Reload the same real /d/[shareToken] link used in the live diagnostic
-- (a Dispatch with a Moment) and confirm getSharedDispatch's stage 4-5
-- dev log (lib/dispatches.ts) now shows a signed URL for every path,
-- with no callLevelError — then confirm the Moment token actually
-- renders inline and opens the full image on tap.

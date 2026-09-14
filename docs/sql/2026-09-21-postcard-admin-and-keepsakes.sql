-- ============================================================
-- TEMPA — POSTCARD ADMIN + KEEPSAKES (ADMIN PHASE 2A-2) — CORE
-- ============================================================
-- STATUS: LIVE. APPLIED AND INDEPENDENTLY VERIFIED (2026-09-23). Do not
-- rerun casually — every statement below has already executed against
-- production Supabase. If this file is ever re-applied to a database
-- where it already ran, every `create or replace function` and the
-- `add column if not exists`/`alter column ... set not null` block are
-- safe to repeat; the new Keepsakes table and its select policy
-- (further below in Part D) are NOT — a repeat run errors, since a
-- table/policy of that name already exists — this file is a historical
-- record of what shipped, not a script meant for casual re-execution.
--
-- ------------------------------------------------------------
-- DEPLOYMENT HISTORY (why this file no longer matches its own original
-- shape) — Repo Reconciliation pass, 2026-09-23:
--
-- The ORIGINAL version of this file combined three things in ONE
-- explicit begin/commit transaction: (A) the postcard_versions
-- snapshot columns + four Admin Postcard RPCs + Keepsakes table/RLS/
-- RPCs, (B) an `insert into storage.buckets` for the new
-- `postcard-artwork` bucket, and (C) two `create policy` statements on
-- `storage.objects` for that same bucket. Run as written, against live
-- Supabase, that single transaction failed with:
--
--   ERROR 40P01: deadlock detected
--
-- independently identified as a lock-order conflict between
-- relation 17296 (storage.buckets) and relation 17306
-- (storage.objects) — Supabase Storage's own internal bucket/object
-- management appears to take locks on those two relations in an order
-- that this migration's single-transaction bucket-insert-then-policy-
-- create sequence could collide with under concurrent Storage
-- activity. Because the whole file was one transaction, Postgres
-- rolled back EVERYTHING — a read-only rollback check afterward
-- confirmed zero new postcard_versions snapshot columns, zero Phase
-- 2A-2 RPCs, no postcard_keepsake_removals table, no postcard-artwork
-- bucket, and the original two postcard_catalog/postcard_versions rows
-- completely untouched.
--
-- The fix was to split deployment into THREE separate transactions,
-- applied in order, each committing independently so a Storage-layer
-- lock conflict in one can never roll back the others:
--
--   1. THIS FILE (Core) — postcard_versions snapshot columns/backfill,
--      the four Admin Postcard RPCs, and the Keepsakes table/RLS/RPCs.
--      NO Storage operations of any kind. Applied successfully; 0 rows
--      returned; independent Core verifier 19/19 PASS.
--   2. docs/sql/2026-09-21-postcard-artwork-bucket.sql — ONLY the
--      `postcard-artwork` bucket insert/configuration. Applied
--      successfully after (1); 0 rows returned; independent bucket
--      verifier PASS.
--   3. docs/sql/2026-09-21-postcard-artwork-policies.sql — ONLY the
--      two storage.objects policies (postcard_artwork_select,
--      postcard_artwork_insert). Applied successfully after (2); 0
--      rows returned; independent policies verifier PASS.
--
-- Final combined live verification (docs/sql/2026-09-21-postcard-
-- admin-and-keepsakes-verify.sql) across the resulting state: 23/23
-- PASS (one initial false-negative on the postcard_catalog.title sync
-- check was a whitespace-sensitive source-string bug in the verifier
-- itself, not a real production issue — see that file's own corrected,
-- whitespace-tolerant regex check).
--
-- Historical data integrity confirmed post-deployment: all 4
-- previously-sent Postcards (across the two catalogue keys) remain
-- intact with 0 orphaned letter_postcards rows, and the exact,
-- mixed-case live key `bangkokAfterRain` is unchanged.
--
-- This file's EXECUTABLE SQL below is otherwise untouched from what
-- actually ran as the successful Core transaction — no statement was
-- rewritten, reordered, or reworded; only Part C (the Storage bucket
-- and its policies) was removed from this file, since it was never
-- part of the Core transaction that actually committed. See the two
-- companion files above for that already-live Storage work.
-- ------------------------------------------------------------
--
-- Builds on the already-LIVE docs/sql/2026-09-14-letter-level-
-- postcards.sql (NOT edited here — its executable SQL is untouched;
-- that migration WAS applied to live Supabase and independently
-- verified, including a real production send — see that file's own
-- corrected header). This is a NEW, additive migration finishing the
-- first-release Postcard product architecture on top of it:
--
--   1. ONE canonical DB-backed catalogue for NEW letter-level
--      Postcards. postcard_catalog/postcard_versions already exist
--      live; this migration widens postcard_versions with the
--      presentation fields (title/location/collection/postmark_text/
--      footer_text) that a delivered Postcard actually renders, so
--      Admin can eventually edit that metadata WITHOUT retroactively
--      changing how an already-sent Postcard looks — the same
--      immutable-per-version discipline the live migration already
--      established for artwork, extended to cover narrative content
--      too. The two existing Version 1 rows (essaouira,
--      bangkokAfterRain) are backfilled from the exact production
--      metadata already live in lib/moments.ts's POSTCARD_CATALOG —
--      not replaced, not duplicated, the same rows.
--   2. Four admin-only RPCs (list/add/create-new-version/set-active),
--      mirroring this codebase's Questions/Announcements admin
--      convention exactly (is_staff('admin'), audit-logged, no
--      hard-delete anywhere). "Edit metadata" and "Replace artwork"
--      are the SAME underlying primitive
--      (admin_create_postcard_version) — both always create a brand
--      new immutable version; the previous version is never mutated
--      and stays exactly as it was for every letter that already
--      references it.
--   3. The recipient-scoped "Keepsakes / Your Postcards" read path —
--      NO new ownership table. get_my_postcards derives a member's
--      delivered Postcards directly from the existing
--      letter_postcards -> letters -> recipient_id relationship
--      (SECURITY DEFINER, auth.uid() hardcoded into the WHERE clause,
--      never a parameter — no user-id oracle of any kind). The ONE
--      genuinely new piece of member-specific state is
--      postcard_keepsake_removals — a narrow suppression record for
--      "Remove from my Postcards," which hides an entry from this
--      read path without touching letter_postcards, the letter, or
--      the sender's own copy of anything.
--
-- (The public-read `postcard-artwork` Storage bucket + its two
-- storage.objects policies — originally listed here as a fourth item —
-- are LIVE, but as the two separate companion transactions/files
-- described above, not as part of this Core transaction.)
--
-- LOCKED PRODUCT MODEL (unchanged): one Postcard maximum per letter;
-- sender-written Reveal Line/back message; a sent Postcard freezes
-- its exact version forever; changing the current catalogue never
-- rewrites an old letter. write_letter/reply_to_letter are NOT
-- touched by this migration at all — they already resolve whichever
-- version is_current at Send time from data alone (no hardcoded key
-- anywhere in either function), so a brand new Postcard added
-- entirely through this migration's new Admin RPCs is sendable
-- immediately, with zero RPC changes required.
-- ============================================================

begin;

-- ============================================================
-- PART A — postcard_versions gains presentation metadata (additive
-- ALTER on the already-live table; its own original columns/rows are
-- untouched, only new columns are added and backfilled)
-- ============================================================

alter table public.postcard_versions
  add column if not exists title text,
  add column if not exists location text,
  add column if not exists collection text,
  add column if not exists postmark_text text,
  add column if not exists footer_text text;

-- Backfill the two existing Version 1 rows from the exact currently-
-- approved production metadata (lib/moments.ts's own POSTCARD_CATALOG
-- content) — the same rows, not replaced, not duplicated. Every
-- future version (for these keys or a brand new one) is inserted with
-- these columns already populated by admin_add_postcard/admin_create_
-- postcard_version below, so this UPDATE only ever needs to run once,
-- against rows that predate these columns existing at all.
update public.postcard_versions
set
  title = 'Essaouira',
  location = 'Atlantic Morocco',
  collection = 'Atlantic Morocco Collection',
  postmark_text = 'ESSAOUIRA' || chr(10) || 'ATLANTIC MOROCCO',
  footer_text = 'Tempa Postcard · Atlantic Morocco Collection'
where postcard_key = 'essaouira' and title is null;

update public.postcard_versions
set
  title = 'Bangkok',
  location = 'Thailand after rain',
  collection = 'Thailand After Rain Collection',
  postmark_text = 'BANGKOK' || chr(10) || 'THAILAND',
  footer_text = 'Tempa Postcard · Thailand After Rain Collection'
where postcard_key = 'bangkokAfterRain' and title is null;

-- Now that every existing row is backfilled, these columns become the
-- same hard NOT NULL guarantee as the rest of an immutable version
-- row — a future INSERT that forgets one of them fails loudly rather
-- than silently shipping a Postcard with a blank title.
alter table public.postcard_versions
  alter column title set not null,
  alter column location set not null,
  alter column collection set not null,
  alter column postmark_text set not null,
  alter column footer_text set not null;

comment on column public.postcard_versions.title is
  'Frozen at version creation — ADMIN EDITS TODAY MUST NOT REWRITE YESTERDAY''S POSTCARDS. Editing a Postcard''s title/location/collection/postmark/footer text (admin_create_postcard_version) always creates a NEW version; this column on an existing version is never updated in place.';

comment on column public.postcard_versions.location is
  'See title''s own comment — frozen per version, never updated in place.';

comment on column public.postcard_versions.collection is
  'See title''s own comment — frozen per version, never updated in place.';

comment on column public.postcard_versions.postmark_text is
  'See title''s own comment — frozen per version, never updated in place.';

comment on column public.postcard_versions.footer_text is
  'See title''s own comment — frozen per version, never updated in place.';


-- ============================================================
-- PART B — the four admin Postcard RPCs
-- ============================================================

-- admin_list_postcards — the "View Postcards" screen: every catalog
-- key (active and inactive both — deactivated ones stay visible,
-- clearly distinguishable, never hidden) joined to its own CURRENT
-- version's presentation fields, plus a simple read-only "how many
-- times has this ever been sent" count for operational context
-- (mirrors admin_list_questions' own answer_count).
create or replace function public.admin_list_postcards()
returns table (
  key text,
  is_active boolean,
  created_at timestamptz,
  current_version_id uuid,
  version_number integer,
  title text,
  country_code text,
  location text,
  collection text,
  postmark_text text,
  footer_text text,
  front_image_path text,
  motion_src text,
  duration_seconds numeric,
  reveal_line_alignment text,
  times_sent bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      c.key,
      c.is_active,
      c.created_at,
      v.id,
      v.version_number,
      v.title,
      c.country_code,
      v.location,
      v.collection,
      v.postmark_text,
      v.footer_text,
      v.front_image_path,
      v.motion_src,
      v.duration_seconds,
      v.reveal_line_alignment,
      (
        select count(*)
        from public.letter_postcards lp
        join public.postcard_versions pv2 on pv2.id = lp.postcard_version_id
        where pv2.postcard_key = c.key
      )
    from public.postcard_catalog c
    join public.postcard_versions v on v.postcard_key = c.key and v.is_current
    order by c.is_active desc, c.created_at desc;
end;
$function$;

revoke all on function public.admin_list_postcards() from public;
grant execute on function public.admin_list_postcards() to authenticated;


-- admin_add_postcard — "Add Postcard": creates a brand new catalog key
-- AND its Version 1 in one call. Every field a delivered Postcard
-- actually renders is required up front; there is no "add now, fill
-- in details later" partial state, matching this checkpoint's own
-- "no bulk CMS machinery" instruction. country_code is the one
-- pre-existing NOT NULL column on postcard_catalog itself (live since
-- 2026-09-14) not otherwise covered by the version snapshot — kept as
-- a real, required parameter rather than silently defaulted.
--
-- Independent SQL review correction pass (2026-09-22): the lower() in
-- v_key below is a DELIBERATE normalization convention for BRAND NEW
-- keys only (this function creates a new identity, so it may choose
-- its own canonical casing) — it must never be applied when looking up
-- an EXISTING key, which is exactly why admin_create_postcard_version
-- and admin_set_postcard_active below no longer lower() their own
-- v_key at all. Existing live keys (e.g. the real, mixed-case
-- `bangkokAfterRain`, created before this convention existed) are
-- never renamed or migrated by this function.
create or replace function public.admin_add_postcard(
  p_key text,
  p_title text,
  p_country_code text,
  p_location text,
  p_collection text,
  p_postmark_text text,
  p_footer_text text,
  p_front_image_path text,
  p_motion_src text default null,
  p_duration_seconds numeric default null,
  p_reveal_line_alignment text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_key text;
  v_title text;
  v_country_code text;
  v_location text;
  v_collection text;
  v_postmark_text text;
  v_footer_text text;
  v_front_image_path text;
  v_new_version_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  v_key := lower(trim(both from coalesce(p_key, '')));
  if v_key = '' then
    raise exception 'A postcard key is required.';
  end if;
  if v_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Postcard key must start with a letter and contain only lowercase letters, numbers, and underscores.';
  end if;
  if exists (select 1 from public.postcard_catalog where key = v_key) then
    raise exception 'A postcard with this key already exists.';
  end if;

  v_title := trim(both from coalesce(p_title, ''));
  v_country_code := upper(trim(both from coalesce(p_country_code, '')));
  v_location := trim(both from coalesce(p_location, ''));
  v_collection := trim(both from coalesce(p_collection, ''));
  v_postmark_text := trim(both from coalesce(p_postmark_text, ''));
  v_footer_text := trim(both from coalesce(p_footer_text, ''));
  v_front_image_path := trim(both from coalesce(p_front_image_path, ''));

  if v_title = '' then raise exception 'A title is required.'; end if;
  if v_country_code = '' then raise exception 'A country code is required.'; end if;
  if v_location = '' then raise exception 'A location is required.'; end if;
  if v_collection = '' then raise exception 'A collection name is required.'; end if;
  if v_postmark_text = '' then raise exception 'Postmark text is required.'; end if;
  if v_footer_text = '' then raise exception 'Footer text is required.'; end if;
  if v_front_image_path = '' then raise exception 'Artwork is required.'; end if;

  if p_reveal_line_alignment is not null and p_reveal_line_alignment not in (
    'top-left', 'top-center', 'top-right',
    'center',
    'bottom-left', 'bottom-center', 'bottom-right'
  ) then
    raise exception 'Unknown reveal line alignment.';
  end if;

  insert into public.postcard_catalog (key, title, country_code, is_active)
  values (v_key, v_title, v_country_code, true);

  insert into public.postcard_versions (
    postcard_key, version_number, title, location, collection, postmark_text, footer_text,
    front_image_path, motion_src, duration_seconds, reveal_line_alignment, is_current
  ) values (
    v_key, 1, v_title, v_location, v_collection, v_postmark_text, v_footer_text,
    v_front_image_path, nullif(trim(both from coalesce(p_motion_src, '')), ''),
    p_duration_seconds, p_reveal_line_alignment, true
  )
  returning id into v_new_version_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'postcard_created',
    'postcard', v_new_version_id, v_key, jsonb_build_object('key', v_key, 'title', v_title)
  );

  return v_new_version_id;
end;
$function$;

revoke all on function public.admin_add_postcard(text, text, text, text, text, text, text, text, text, numeric, text) from public;
grant execute on function public.admin_add_postcard(text, text, text, text, text, text, text, text, text, numeric, text) to authenticated;


-- admin_create_postcard_version — the ONE shared primitive behind both
-- "Edit current descriptive metadata" and "Replace artwork / presentation
-- version" (Section E.3/E.5): always creates a brand-new immutable
-- version row and flips it current, never updates an existing version
-- in place. The Admin UI pre-fills every field from the current
-- version so an "edit metadata only" submission simply resubmits the
-- same artwork paths unchanged, and an "replace artwork only"
-- submission resubmits the same text unchanged — this RPC doesn't need
-- to know which fields actually changed. Previous versions remain
-- exactly as they were, and every letter_postcards row already
-- pointing at one keeps pointing at it forever.
--
-- Independent SQL review correction pass (2026-09-22):
--   1. p_key is an EXISTING, durable, case-sensitive identity (the live
--      catalogue already contains the mixed-case key
--      `bangkokAfterRain`, and write_letter/reply_to_letter compare
--      postcard_catalog.key = v_postcard_key exactly, with no
--      lower()). This lookup must match that same exact identity —
--      trimmed only, never lower()'d, or the real live Bangkok
--      Postcard becomes impossible to edit/version/deactivate through
--      Admin ever again.
--   2. Two simultaneous Admin requests for the SAME key must not race
--      on version_number / is_current — `select ... for update` locks
--      that ONE postcard_catalog row for the remainder of this
--      transaction, serializing operations per-Postcard only (a
--      concurrent request against a DIFFERENT key is entirely
--      unaffected). This is in addition to, not instead of, the
--      standing postcard_versions_unique_number/postcard_versions_
--      one_current_per_key constraints, which remain the actual
--      database-level guarantee either way.
--   3. postcard_catalog.title is the CURRENT catalogue title (used by
--      admin_list_postcards' own key/title header and anywhere else
--      the catalog row itself is surfaced); postcard_versions.title is
--      each version's own HISTORICAL frozen title. When this RPC
--      creates a new current version, it updates postcard_catalog.
--      title to match in the SAME transaction — a previous version's
--      own title column is never touched.
create or replace function public.admin_create_postcard_version(
  p_key text,
  p_title text,
  p_location text,
  p_collection text,
  p_postmark_text text,
  p_footer_text text,
  p_front_image_path text,
  p_motion_src text default null,
  p_duration_seconds numeric default null,
  p_reveal_line_alignment text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_key text;
  v_title text;
  v_location text;
  v_collection text;
  v_postmark_text text;
  v_footer_text text;
  v_front_image_path text;
  v_next_version_number integer;
  v_new_version_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  -- Trim only — NEVER lower(). p_key names an EXISTING, already-live
  -- catalog key (e.g. the real, mixed-case `bangkokAfterRain`), so
  -- this must match the exact durable identity write_letter/
  -- reply_to_letter themselves compare against, not a normalized form.
  v_key := trim(both from coalesce(p_key, ''));

  -- Locks this ONE postcard_catalog row for the rest of the
  -- transaction (PERFORM ... FOR UPDATE, checked via FOUND) —
  -- serializes concurrent admin_create_postcard_version calls for the
  -- SAME key only; a call for a different key is entirely unaffected,
  -- since only that key's own row is locked. Also doubles as the
  -- existence check.
  perform 1 from public.postcard_catalog where key = v_key for update;
  if not found then
    raise exception 'Postcard not found.';
  end if;

  v_title := trim(both from coalesce(p_title, ''));
  v_location := trim(both from coalesce(p_location, ''));
  v_collection := trim(both from coalesce(p_collection, ''));
  v_postmark_text := trim(both from coalesce(p_postmark_text, ''));
  v_footer_text := trim(both from coalesce(p_footer_text, ''));
  v_front_image_path := trim(both from coalesce(p_front_image_path, ''));

  if v_title = '' then raise exception 'A title is required.'; end if;
  if v_location = '' then raise exception 'A location is required.'; end if;
  if v_collection = '' then raise exception 'A collection name is required.'; end if;
  if v_postmark_text = '' then raise exception 'Postmark text is required.'; end if;
  if v_footer_text = '' then raise exception 'Footer text is required.'; end if;
  if v_front_image_path = '' then raise exception 'Artwork is required.'; end if;

  if p_reveal_line_alignment is not null and p_reveal_line_alignment not in (
    'top-left', 'top-center', 'top-right',
    'center',
    'bottom-left', 'bottom-center', 'bottom-right'
  ) then
    raise exception 'Unknown reveal line alignment.';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version_number
  from public.postcard_versions where postcard_key = v_key;

  -- Two separate statements (clear the old current, then insert the
  -- new one) rather than one combined statement — same transient-
  -- uniqueness reasoning as questions_current_position_unique/
  -- questions_is_flagship_unique elsewhere in this codebase: never ask
  -- a single statement's row set to hold two is_current = true rows
  -- for the same key at once. Safe from a concurrent duplicate
  -- version_number/is_current race because the postcard_catalog row
  -- locked above already serializes this whole block per-key.
  update public.postcard_versions set is_current = false where postcard_key = v_key and is_current;

  insert into public.postcard_versions (
    postcard_key, version_number, title, location, collection, postmark_text, footer_text,
    front_image_path, motion_src, duration_seconds, reveal_line_alignment, is_current
  ) values (
    v_key, v_next_version_number, v_title, v_location, v_collection, v_postmark_text, v_footer_text,
    v_front_image_path, nullif(trim(both from coalesce(p_motion_src, '')), ''),
    p_duration_seconds, p_reveal_line_alignment, true
  )
  returning id into v_new_version_id;

  -- Keep the catalog's own CURRENT title in sync with the version that
  -- is now current — postcard_catalog.title always reflects "what this
  -- Postcard is called right now"; every earlier postcard_versions row
  -- (including the one just superseded) keeps its own frozen title
  -- untouched by this UPDATE.
  update public.postcard_catalog set title = v_title where key = v_key;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'postcard_version_created',
    'postcard', v_new_version_id, v_key, jsonb_build_object('version_number', v_next_version_number)
  );

  return v_new_version_id;
end;
$function$;

revoke all on function public.admin_create_postcard_version(text, text, text, text, text, text, text, text, numeric, text) from public;
grant execute on function public.admin_create_postcard_version(text, text, text, text, text, text, text, text, numeric, text) to authenticated;


-- admin_set_postcard_active — "Activate / deactivate": stops NEW sends
-- from offering this Postcard (write_letter/reply_to_letter's own
-- `is_active` check, unchanged, already enforces this); historical
-- letters remain perfectly readable regardless (postcard_catalog/
-- postcard_versions stay `using (true)` — visibility was never tied to
-- is_active, see the live migration's own §5). No delete RPC exists
-- anywhere in this file, matching this checkpoint's explicit "DO NOT
-- BUILD: Delete Postcard" instruction — and a catalog key or version
-- that has ever been sent already can't be deleted regardless, by
-- ordinary foreign-key semantics (postcard_versions.postcard_key and
-- letter_postcards.postcard_version_id both reference with no ON
-- DELETE clause, i.e. NO ACTION — Postgres refuses the DELETE outright).
--
-- Independent SQL review correction pass (2026-09-22): p_key names an
-- EXISTING, durable, case-sensitive identity (the live catalogue
-- already contains the mixed-case key `bangkokAfterRain`) — trimmed
-- only, never lower()'d, matching admin_create_postcard_version's own
-- correction and the exact-match comparison write_letter/
-- reply_to_letter already perform.
create or replace function public.admin_set_postcard_active(p_key text, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_key text;
  v_was_active boolean;
  v_current_version_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if p_active is null then
    raise exception 'An active state is required.';
  end if;

  v_key := trim(both from coalesce(p_key, ''));
  select is_active into v_was_active from public.postcard_catalog where key = v_key;
  if v_was_active is null then
    raise exception 'Postcard not found.';
  end if;

  if v_was_active = p_active and p_active then
    raise exception 'This Postcard is already active.';
  end if;
  if v_was_active = p_active and not p_active then
    raise exception 'This Postcard is already inactive.';
  end if;

  update public.postcard_catalog set is_active = p_active where key = v_key;

  select id into v_current_version_id from public.postcard_versions where postcard_key = v_key and is_current;
  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    case when p_active then 'postcard_activated' else 'postcard_deactivated' end,
    'postcard', v_current_version_id, v_key, jsonb_build_object('is_active', p_active)
  );
end;
$function$;

revoke all on function public.admin_set_postcard_active(text, boolean) from public;
grant execute on function public.admin_set_postcard_active(text, boolean) to authenticated;


-- ============================================================
-- PART D — Keepsakes: the recipient-scoped "Your Postcards" read path
-- ============================================================
-- Independent SQL review correction pass (2026-09-22) — migration-
-- order cleanup only, no product-semantics change: this Part is now
-- ordered strictly by dependency (table, then its RLS/policy/grants,
-- then the two functions that reference it) rather than defining
-- get_my_postcards() before the table it queries existed. PL/pgSQL
-- would have deferred relation resolution to execution time either
-- way, but this migration should never rely on that — every object is
-- now created before anything that depends on it.

-- postcard_keepsake_removals — the ONE narrow, member-specific state
-- this checkpoint legitimately needs (Section H): a per-recipient
-- suppression record for "Remove from my Postcards." Deliberately NOT
-- a generic ownership/collectible table — it records nothing about
-- WHAT was received (that's letter_postcards' job, untouched), only
-- THAT this member chose to hide this one delivered Postcard from
-- their own Keepsakes view. Removing never deletes letter_postcards,
-- never touches the original letter, never touches the sender's
-- history, and never touches the immutable version — the original
-- historical letter still shows its Postcard exactly as it always did.
create table public.postcard_keepsake_removals (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  letter_id uuid not null
    references public.letters(id)
    on delete cascade,

  removed_at timestamptz not null default now(),

  primary key (user_id, letter_id)
);

alter table public.postcard_keepsake_removals enable row level security;

-- Self-scoped read only, for transparency/debugging — every real write
-- happens through remove_my_postcard below, whose SECURITY DEFINER
-- privileges need no INSERT policy of their own to succeed. No
-- INSERT/UPDATE/DELETE policy is granted to authenticated directly.
create policy postcard_keepsake_removals_select_own
  on public.postcard_keepsake_removals
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.postcard_keepsake_removals from public, anon, authenticated;
grant select on public.postcard_keepsake_removals to authenticated;


-- get_my_postcards — derives the caller's own delivered Postcards
-- directly from letter_postcards -> letters -> recipient_id. NO new
-- ownership table: this IS the source of truth (Section G). auth.uid()
-- is hardcoded into the WHERE clause, never accepted as a parameter —
-- there is no way to request "someone else's" Postcards through this
-- function at all (no user-id oracle). SECURITY DEFINER is required to
-- read the base `letters` table directly (authenticated holds ZERO
-- grants on it, by design since 2026-08-30) — the exact same
-- established pattern as other purpose-built aggregate RPCs in this
-- codebase (e.g. get_post_closure_recommendations), scoped here
-- entirely by `l.recipient_id = auth.uid()`. Defined AFTER
-- postcard_keepsake_removals above, which its own NOT EXISTS clause
-- queries.
create or replace function public.get_my_postcards()
returns table (
  letter_id uuid,
  correspondence_id uuid,
  delivered_at timestamptz,
  reveal_line text,
  back_message text,
  sender_pseudonym_snapshot text,
  postcard_key text,
  title text,
  location text,
  collection text,
  postmark_text text,
  footer_text text,
  front_image_path text,
  motion_src text,
  duration_seconds numeric,
  reveal_line_alignment text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  return query
    select
      l.id,
      l.correspondence_id,
      l.deliver_at,
      lp.reveal_line,
      lp.back_message,
      lp.sender_pseudonym_snapshot,
      pv.postcard_key,
      pv.title,
      pv.location,
      pv.collection,
      pv.postmark_text,
      pv.footer_text,
      pv.front_image_path,
      pv.motion_src,
      pv.duration_seconds,
      pv.reveal_line_alignment
    from public.letter_postcards lp
    join public.letters l on l.id = lp.letter_id
    join public.postcard_versions pv on pv.id = lp.postcard_version_id
    where l.recipient_id = auth.uid()
      and l.deliver_at <= now()
      and not exists (
        select 1 from public.postcard_keepsake_removals r
        where r.user_id = auth.uid() and r.letter_id = l.id
      )
    order by l.deliver_at desc;
end;
$function$;

revoke all on function public.get_my_postcards() from public;
grant execute on function public.get_my_postcards() to authenticated;


-- remove_my_postcard — "Remove from my Postcards" (never "Delete
-- Postcard" — member-facing wording is enforced at the UI layer, this
-- RPC only ever inserts a suppression record). Validates the target is
-- genuinely a delivered Postcard this caller actually received before
-- recording anything, so this table can never accumulate rows for
-- letters the caller was never the recipient of.
create or replace function public.remove_my_postcard(p_letter_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select exists (
    select 1
    from public.letter_postcards lp
    join public.letters l on l.id = lp.letter_id
    where lp.letter_id = p_letter_id
      and l.recipient_id = auth.uid()
      and l.deliver_at <= now()
  ) into v_exists;

  if not v_exists then
    raise exception 'Postcard not found.';
  end if;

  if exists (
    select 1 from public.postcard_keepsake_removals
    where user_id = auth.uid() and letter_id = p_letter_id
  ) then
    raise exception 'This Postcard has already been removed from your collection.';
  end if;

  insert into public.postcard_keepsake_removals (user_id, letter_id)
  values (auth.uid(), p_letter_id);
end;
$function$;

revoke all on function public.remove_my_postcard(uuid) from public;
grant execute on function public.remove_my_postcard(uuid) to authenticated;

commit;

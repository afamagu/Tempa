-- ============================================================
-- TEMPA — POSTCARD ADMIN + KEEPSAKES — POST-APPLY VERIFIER
-- ============================================================
-- STATUS: READ-ONLY ONLY — this file contains no INSERT, UPDATE,
-- DELETE, ALTER, CREATE, or DROP statement anywhere. Running it
-- changes nothing; it is safe to run at any time, repeatedly. Do NOT
-- execute it from Claude Code / an automated agent against Supabase —
-- run it manually, from wherever the owner runs one-off read-only SQL.
--
-- Covers the FINAL state of all three Admin Phase 2A-2 Postcard/
-- Keepsakes transactions, now tracked as three separate files (Repo
-- Reconciliation pass, 2026-09-23 — see docs/sql/2026-09-21-postcard-
-- artwork-bucket.sql's header for the full deadlock/split history):
--   1. docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql (Core) —
--      LIVE, applied and independently verified.
--   2. docs/sql/2026-09-21-postcard-artwork-bucket.sql — LIVE, applied
--      after (1).
--   3. docs/sql/2026-09-21-postcard-artwork-policies.sql — LIVE,
--      applied after (2).
-- All three have already been manually applied and independently
-- verified against production (23/23 PASS on the corrected checks
-- below, including the catalog-title-sync fix in check 18). This file
-- exists so that same verification can be repeated at any time — after
-- a fresh environment applies all three files in order, or simply to
-- re-confirm production's current state — not merely as a pre-apply
-- gate.
--
-- Each check below is a single SELECT producing one PASS/FAIL row via
-- a shared (check_no, check_name, status, detail) shape, unioned into
-- one compact result set — run the whole file and scan for any row
-- where status <> 'PASS'.
-- ============================================================

with

-- 01 — the five presentation columns exist on postcard_versions and
-- are all NOT NULL (the backfill + `alter column ... set not null`
-- from Part A actually landed).
check_01 as (
  select
    '01' as check_no,
    'snapshot columns exist and are NOT NULL' as check_name,
    case
      when count(*) filter (
        where column_name in ('title', 'location', 'collection', 'postmark_text', 'footer_text')
          and is_nullable = 'NO'
      ) = 5
      then 'PASS' else 'FAIL'
    end as status,
    string_agg(column_name || ':' || is_nullable, ', ' order by column_name) as detail
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'postcard_versions'
    and column_name in ('title', 'location', 'collection', 'postmark_text', 'footer_text')
),

-- 02 — the existing Essaouira Version 1 row carries the exact
-- production metadata this migration's backfill was supposed to set.
check_02 as (
  select
    '02' as check_no,
    'Essaouira v1 metadata backfilled correctly' as check_name,
    case
      when exists (
        select 1 from public.postcard_versions
        where postcard_key = 'essaouira'
          and version_number = 1
          and title = 'Essaouira'
          and location = 'Atlantic Morocco'
          and collection = 'Atlantic Morocco Collection'
          and postmark_text = 'ESSAOUIRA' || chr(10) || 'ATLANTIC MOROCCO'
          and footer_text = 'Tempa Postcard · Atlantic Morocco Collection'
      )
      then 'PASS' else 'FAIL'
    end as status,
    coalesce(
      (select title || ' / ' || location || ' / ' || collection
       from public.postcard_versions where postcard_key = 'essaouira' and version_number = 1),
      'no essaouira v1 row found'
    ) as detail
),

-- 03 — same for the existing Bangkok Version 1 row.
check_03 as (
  select
    '03' as check_no,
    'Bangkok v1 metadata backfilled correctly' as check_name,
    case
      when exists (
        select 1 from public.postcard_versions
        where postcard_key = 'bangkokAfterRain'
          and version_number = 1
          and title = 'Bangkok'
          and location = 'Thailand after rain'
          and collection = 'Thailand After Rain Collection'
          and postmark_text = 'BANGKOK' || chr(10) || 'THAILAND'
          and footer_text = 'Tempa Postcard · Thailand After Rain Collection'
      )
      then 'PASS' else 'FAIL'
    end as status,
    coalesce(
      (select title || ' / ' || location || ' / ' || collection
       from public.postcard_versions where postcard_key = 'bangkokAfterRain' and version_number = 1),
      'no bangkokAfterRain v1 row found'
    ) as detail
),

-- 04 — the real, live, mixed-case key still exists exactly as-is, and
-- no lowercase duplicate (`bangkokafterrain`) was ever accidentally
-- created by a buggy normalization.
check_04 as (
  select
    '04' as check_no,
    'exact live key bangkokAfterRain still exists unchanged' as check_name,
    case
      when exists (select 1 from public.postcard_catalog where key = 'bangkokAfterRain')
        and not exists (select 1 from public.postcard_catalog where key = 'bangkokafterrain')
      then 'PASS' else 'FAIL'
    end as status,
    'bangkokAfterRain exists: ' || exists (select 1 from public.postcard_catalog where key = 'bangkokAfterRain')::text
      || '; bangkokafterrain exists: ' || exists (select 1 from public.postcard_catalog where key = 'bangkokafterrain')::text
    as detail
),

-- 05 — the standing partial unique index enforcing at most one current
-- version per key is still in place (this migration must never weaken
-- it).
check_05 as (
  select
    '05' as check_no,
    'at most one current version per key remains enforced' as check_name,
    case
      when exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and tablename = 'postcard_versions'
          and indexname = 'postcard_versions_one_current_per_key'
      )
      then 'PASS' else 'FAIL'
    end as status,
    coalesce(
      (select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'postcard_versions'
         and indexname = 'postcard_versions_one_current_per_key'),
      'index not found'
    ) as detail
),

-- 06 — every catalog key actually has exactly one current version row
-- right now (the index in 05 proves "at most one" is enforced; this
-- proves "exactly one" actually holds for real data).
check_06 as (
  select
    '06' as check_no,
    'exactly one current version exists for each catalogue card' as check_name,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
    coalesce(string_agg(key || ':' || current_count::text, ', '), 'none') as detail
  from (
    select c.key, count(v.id) as current_count
    from public.postcard_catalog c
    left join public.postcard_versions v on v.postcard_key = c.key and v.is_current
    group by c.key
    having count(v.id) <> 1
  ) offenders
),

-- 07 — the four Admin Postcard RPCs exist in the public schema.
check_07 as (
  select
    '07' as check_no,
    'required four Admin Postcard RPCs exist' as check_name,
    case when count(*) = 4 then 'PASS' else 'FAIL' end as status,
    string_agg(proname, ', ' order by proname) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_list_postcards', 'admin_add_postcard', 'admin_create_postcard_version', 'admin_set_postcard_active')
),

-- 08 — each of those four is SECURITY DEFINER with a fixed,
-- non-mutable search_path (pg_catalog), never left to resolve `public`
-- at call time.
check_08 as (
  select
    '08' as check_no,
    'Admin Postcard RPCs are SECURITY DEFINER + hardened search_path' as check_name,
    case
      when count(*) filter (
        where prosecdef
          and exists (select 1 from unnest(coalesce(proconfig, '{}')) cfg where cfg like 'search_path=%pg_catalog%')
      ) = 4
      then 'PASS' else 'FAIL'
    end as status,
    string_agg(proname || ':secdef=' || prosecdef::text || ':cfg=' || coalesce(array_to_string(proconfig, '|'), 'none'), ', ' order by proname) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_list_postcards', 'admin_add_postcard', 'admin_create_postcard_version', 'admin_set_postcard_active')
),

-- 09 — anon has no execute grant on any of the four; authenticated
-- does.
check_09 as (
  select
    '09' as check_no,
    'Admin RPC grants: anon false / authenticated true' as check_name,
    case
      when count(*) filter (where has_function_privilege('anon', p.oid, 'execute')) = 0
        and count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) = 4
      then 'PASS' else 'FAIL'
    end as status,
    string_agg(
      proname || ':anon=' || has_function_privilege('anon', p.oid, 'execute')::text
      || ':auth=' || has_function_privilege('authenticated', p.oid, 'execute')::text,
      ', ' order by proname
    ) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_list_postcards', 'admin_add_postcard', 'admin_create_postcard_version', 'admin_set_postcard_active')
),

-- 10 — the two EXISTING-key mutation RPCs never lower() their own key
-- before lookup (the corrected bug from the independent review pass).
-- admin_add_postcard is DELIBERATELY excluded — its lower() only
-- normalizes a BRAND NEW key, never an existing one.
check_10 as (
  select
    '10' as check_no,
    'existing-key RPC source does not lowercase the key' as check_name,
    case
      when count(*) filter (where pg_get_functiondef(p.oid) ~* 'lower\s*\(\s*trim') = 0
      then 'PASS' else 'FAIL'
    end as status,
    string_agg(proname || ':has_lower_trim=' || (pg_get_functiondef(p.oid) ~* 'lower\s*\(\s*trim')::text, ', ' order by proname) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_create_postcard_version', 'admin_set_postcard_active')
),

-- 11 — admin_create_postcard_version locks the target postcard_catalog
-- row (FOR UPDATE) before computing the next version number / flipping
-- is_current, serializing concurrent version-creation per key.
--
-- Anchored to the actual EXECUTABLE `perform ... for update` statement
-- via a whitespace-tolerant, case-SENSITIVE regex (lowercase, matching
-- this codebase's own SQL casing convention) rather than a bare
-- case-insensitive `~* 'for update'` scan — the latter would also
-- match the words "FOR UPDATE" occurring inside this same function's
-- own preceding doc comment (pg_get_functiondef returns a plpgsql
-- function's body verbatim, comments included), which is exactly the
-- kind of false-positive/false-negative source-string bug check 18
-- below was also corrected for.
check_11 as (
  select
    '11' as check_no,
    'admin_create_postcard_version includes per-card serialization/lock' as check_name,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_postcard_version'
          and pg_get_functiondef(p.oid) ~ 'perform[[:space:]]+1[[:space:]]+from[[:space:]]+public\.postcard_catalog[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*v_key[[:space:]]+for[[:space:]]+update'
      )
      then 'PASS' else 'FAIL'
    end as status,
    'checked pg_get_functiondef for the executable perform ... for update statement (not merely the phrase in a comment)' as detail
),

-- 12 — the postcard-artwork bucket is public (read), and only an
-- is_staff('admin') caller may insert into it. Checks the FINAL live
-- state only — this bucket row and these policies were actually
-- created by two SEPARATE transactions/files (docs/sql/2026-09-21-
-- postcard-artwork-bucket.sql, then docs/sql/2026-09-21-postcard-
-- artwork-policies.sql), split apart specifically to avoid the
-- storage.buckets/storage.objects deadlock the original combined
-- migration hit — this check doesn't care which file created what, only
-- that the end result is correct.
check_12 as (
  select
    '12' as check_no,
    'postcard-artwork bucket has intended public/read + admin-only-write posture' as check_name,
    case
      when exists (select 1 from storage.buckets where id = 'postcard-artwork' and public = true)
        and exists (
          select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'postcard_artwork_insert'
            and cmd = 'INSERT'
            and with_check ilike '%is_staff%admin%'
        )
      then 'PASS' else 'FAIL'
    end as status,
    'bucket public: ' || coalesce((select public::text from storage.buckets where id = 'postcard-artwork'), 'bucket not found') as detail
),

-- 13 — postcard_keepsake_removals has RLS enabled, a self-scoped
-- select policy, and no direct insert/update/delete grant to
-- authenticated (writes only via remove_my_postcard's own SECURITY
-- DEFINER privileges).
check_13 as (
  select
    '13' as check_no,
    'postcard_keepsake_removals RLS/grants are correct' as check_name,
    case
      when exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'postcard_keepsake_removals' and c.relrowsecurity
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'postcard_keepsake_removals'
          and policyname = 'postcard_keepsake_removals_select_own' and cmd = 'SELECT'
      )
      and has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'SELECT')
      and not has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'INSERT')
      and not has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'DELETE')
      then 'PASS' else 'FAIL'
    end as status,
    'select=' || has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'SELECT')::text
      || ' insert=' || has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'INSERT')::text
      || ' update=' || has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'UPDATE')::text
      || ' delete=' || has_table_privilege('authenticated', 'public.postcard_keepsake_removals', 'DELETE')::text
    as detail
),

-- 14 — get_my_postcards: authenticated may execute it, anon may not,
-- and it is SECURITY DEFINER (required to read the base `letters`
-- table, which authenticated holds zero direct grants on).
check_14 as (
  select
    '14' as check_no,
    'get_my_postcards is authenticated-only and SECURITY DEFINER' as check_name,
    case
      when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_my_postcards'
          and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
      )
      then 'PASS' else 'FAIL'
    end as status,
    'checked prosecdef + anon/authenticated execute grants' as detail
),

-- 15 — same shape of check for remove_my_postcard.
check_15 as (
  select
    '15' as check_no,
    'remove_my_postcard is authenticated-only and SECURITY DEFINER' as check_name,
    case
      when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'remove_my_postcard'
          and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
      )
      then 'PASS' else 'FAIL'
    end as status,
    'checked prosecdef + anon/authenticated execute grants' as detail
),

-- 16 — every existing letter_postcards row still resolves to a real,
-- present postcard_versions row (the immutable version a delivered
-- Postcard depends on was never orphaned). The live FK already
-- guarantees this structurally; this is a direct data-level cross-
-- check on top of that guarantee.
check_16 as (
  select
    '16' as check_no,
    'existing letter_postcards rows still reference immutable postcard_versions' as check_name,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
    count(*)::text || ' orphaned letter_postcards row(s)' as detail
  from public.letter_postcards lp
  left join public.postcard_versions pv on pv.id = lp.postcard_version_id
  where pv.id is null
),

-- 17 — no second/duplicate ownership table was introduced beyond the
-- one narrow suppression table this checkpoint explicitly authorized.
check_17 as (
  select
    '17' as check_no,
    'no duplicate/second ownership table was introduced' as check_name,
    case
      when count(*) filter (where table_name not in ('postcard_catalog', 'postcard_versions', 'letter_postcards', 'postcard_keepsake_removals')) = 0
      then 'PASS' else 'FAIL'
    end as status,
    coalesce(
      string_agg(table_name, ', ') filter (where table_name not in ('postcard_catalog', 'postcard_versions', 'letter_postcards', 'postcard_keepsake_removals')),
      'none beyond the four expected tables'
    ) as detail
  from information_schema.tables
  where table_schema = 'public'
    and (table_name ilike '%postcard%' or table_name ilike '%keepsake%')
),

-- 18 — postcard_catalog.title stays in sync with the CURRENT version:
-- admin_create_postcard_version updates postcard_catalog.title to the
-- new version's title, in the same transaction it creates that version
-- in. Repo Reconciliation pass, 2026-09-23 — REPLACES a prior literal
-- ILIKE-across-pg_get_functiondef-output check, which false-failed in
-- production because of a line-break/whitespace difference between the
-- literal expected substring and the function body's actual stored
-- formatting. This whitespace-TOLERANT regex (POSIX [[:space:]]
-- classes, matching one or more of any whitespace character including
-- newlines between tokens) is the proven fix, run directly against
-- live Supabase during the original deployment's own verification.
check_18 as (
  select
    '18' as check_no,
    'postcard_catalog.title stays in sync with the current version' as check_name,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_postcard_version'
          and pg_get_functiondef(p.oid) ~ 'update[[:space:]]+public\.postcard_catalog[[:space:]]+set[[:space:]]+title[[:space:]]*=[[:space:]]*v_title[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*v_key'
      )
      then 'PASS' else 'FAIL'
    end as status,
    'checked pg_get_functiondef with a whitespace-tolerant regex (not a literal substring match)' as detail
)

select * from check_01
union all select * from check_02
union all select * from check_03
union all select * from check_04
union all select * from check_05
union all select * from check_06
union all select * from check_07
union all select * from check_08
union all select * from check_09
union all select * from check_10
union all select * from check_11
union all select * from check_12
union all select * from check_13
union all select * from check_14
union all select * from check_15
union all select * from check_16
union all select * from check_17
union all select * from check_18
order by check_no;

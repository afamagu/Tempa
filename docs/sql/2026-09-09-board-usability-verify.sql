-- Tempa — Board usability / author control checkpoint: read-only
-- post-migration verification. Run AFTER
-- docs/sql/2026-09-09-board-usability.sql has been applied. Every
-- statement here is a SELECT — nothing writes, alters, or deletes.
-- Scoped to what THIS migration changed; it does not re-verify the
-- whole Dispatches/Board contract (see
-- docs/sql/2026-09-07-dispatches-and-board-verify.sql for that).

-- 1. New/changed functions exist and are SECURITY DEFINER with a
--    pg_catalog-pinned search_path, matching every other narrow RPC in
--    this schema.
select
  p.proname as function_name,
  case p.prosecdef when true then '[OK — DEFINER]' else '[WRONG — is INVOKER]' end as security_mode,
  (select setting from unnest(p.proconfig) as setting where setting like 'search_path=%') as search_path_setting
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('share_dispatch', 'update_dispatch', 'delete_dispatch', 'pin_dispatch', 'unpin_dispatch')
order by p.proname;
-- Expect: all five DEFINER; search_path_setting = 'search_path=pg_catalog' for all five.

-- 2. Execute grants: authenticated only, never anon or public, for all
--    five functions.
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('share_dispatch', 'update_dispatch', 'delete_dispatch', 'pin_dispatch', 'unpin_dispatch')
  and grantee in ('public', 'anon', 'authenticated')
order by routine_name, grantee;
-- Expect: every row grantee = 'authenticated'. No row for 'anon' or 'public'.

-- 3. share_dispatch no longer requires authorship — confirmed
--    structurally by checking its function body text does not mention
--    author_id (a behavioral change can't be proven by a static SELECT
--    alone; pair this with the live-test steps in the Build Guide).
select
  case
    when pg_get_functiondef(p.oid) ilike '%author_id%' then '[UNEXPECTED — still references author_id]'
    else '[OK — no author_id check in share_dispatch]'
  end as share_dispatch_ownership_check
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname = 'share_dispatch';

-- 4. Storage: the new delete policy exists, scoped to authenticated
--    and to each caller's own folder only — never anon, never any
--    other author's folder.
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname = 'dispatch_photos_delete';
-- Expect: one row, cmd = 'd' (delete), roles = {authenticated}, qual
-- mentions "(storage.foldername(name))[1]" — the same own-folder shape
-- as dispatch_photos_insert.

-- 5. profiles.pinned_dispatch_id exists, is nullable, and references
--    dispatches with ON DELETE SET NULL.
select
  a.attname as column_name,
  not a.attnotnull as is_nullable,
  confdeltype as on_delete_action
from pg_attribute a
join pg_constraint c on c.conrelid = a.attrelid and a.attnum = any (c.conkey)
where a.attrelid = 'public.profiles'::regclass
  and a.attname = 'pinned_dispatch_id'
  and c.contype = 'f';
-- Expect: is_nullable = true, on_delete_action = 'n' (SET NULL).

-- 6. public_profiles exposes pinned_dispatch_id (and nothing beyond
--    the intended allowlist — eyeball the full column list here).
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_profiles'
order by ordinal_position;
-- Expect: id, pseudonym, country, gender, gender_custom, age_range,
-- (languages, intent — only if that earlier migration is live),
-- pinned_dispatch_id. Never email or any other profiles column.

-- 7. Sanity check the pin/unpin functions round-trip on a real row —
--    read-only: shows any profile that currently has a pinned Dispatch
--    and confirms it points at a real, still-existing Dispatch (a
--    dangling reference here would mean on delete set null did not
--    fire correctly, which should be structurally impossible given
--    check 5, but this confirms the live data agrees).
select pr.id as profile_id, pr.pinned_dispatch_id, d.id as dispatch_exists
from public.profiles pr
left join public.dispatches d on d.id = pr.pinned_dispatch_id
where pr.pinned_dispatch_id is not null;
-- Expect: dispatch_exists is never null for any row returned (none
-- will be returned until at least one member has pinned something).

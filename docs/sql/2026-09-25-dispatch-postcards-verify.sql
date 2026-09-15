-- ============================================================
-- TEMPA — DISPATCH POSTCARDS, CHECKPOINT 2: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-25-dispatch-postcards.sql has been applied. Every
-- statement below is a SELECT/has_*_privilege check — no mutation of
-- any kind, no INSERT/UPDATE/DELETE, no fixture data of any kind.
--
-- Follows the hardened conventions established by docs/sql/2026-09-24-
-- dispatch-worth-reading-verify.sql: every CTE is driven off a fixed
-- one-row anchor (never a bare catalog-filtered FROM that could
-- silently return zero rows), every derived column is wrapped in
-- coalesce(..., false), and every function-existence check resolves the
-- EXACT oid to_regprocedure finds for that function's fixed signature,
-- not merely by proname (so a stale overload with the wrong arg count
-- cannot masquerade as "the function exists"). The SUMMARY query is
-- therefore guaranteed to return EXACTLY ONE row against any reachable
-- database.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
table_check as (
  select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_postcards'
    ) as table_exists,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_postcards' and c.relrowsecurity
    ) as rls_enabled
),
-- Column shape, driven off a fixed 5-row VALUES list, so this always
-- returns one row regardless of whether the table exists.
column_check as (
  select
    bool_and(present) as all_columns_present
  from (
    select
      col_name,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'dispatch_postcards'
          and column_name = col_name
          and (is_nullable = expected_nullable)
      ) as present
    from (values
      ('dispatch_id', 'NO'),
      ('postcard_version_id', 'NO'),
      ('reveal_line', 'YES'),
      ('back_message', 'NO'),
      ('sender_pseudonym_snapshot', 'NO'),
      ('created_at', 'NO')
    ) as expected(col_name, expected_nullable)
  ) as checked
),
-- dispatch_id is itself the PRIMARY KEY — strict 1:1 with a Dispatch,
-- structurally enforcing "at most one Postcard."
pk_check as (
  select
    coalesce(
      bool_and(att.attname = 'dispatch_id') and count(*) = 1,
      false
    ) as dispatch_id_is_sole_pk
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conrelid = to_regclass('public.dispatch_postcards')
    and con.contype = 'p'
  left join lateral unnest(con.conkey) as k(attnum) on true
  left join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
),
-- Both FKs: dispatch_id CASCADEs (deleting the Dispatch removes its
-- Postcard association — no orphan row); postcard_version_id has NO
-- ACTION (an immutable version can never be deleted out from under a
-- historical association, matching postcard_versions' own no-delete-RPC
-- posture).
fk_check as (
  select
    bool_and(
      actual.oid is not null
      and actual.confdeltype = expected.expected_deltype
      and actual.confrelid = to_regclass(expected.expected_target)
    ) as all_fks_correct
  from (values
    ('dispatch_postcards_dispatch_id_fkey', 'c', 'public.dispatches'),
    ('dispatch_postcards_postcard_version_id_fkey', 'a', 'public.postcard_versions')
  ) as expected(conname, expected_deltype, expected_target)
  left join pg_constraint actual
    on actual.conname = expected.conname
    and actual.conrelid = to_regclass('public.dispatch_postcards')
    and actual.contype = 'f'
),
-- VERIFIER FIX (final pre-Supabase review, live-diagnostic-driven): the
-- migration is LIVE and unchanged by this pass — the original single
-- ilike-against-source-spelling check (`%between 1 and 200%`) read false
-- live purely because PostgreSQL normalizes a stored CHECK constraint's
-- BETWEEN into an equivalent `>= ... AND <= ...` pair when it stores/
-- pretty-prints the constraint (confirmed via a read-only live
-- diagnostic: both constraints' actual stored definitions are
-- semantically correct, just reformatted) — not a real defect. Fixed by
-- proving the actual SEMANTIC bounds directly, tolerant of PostgreSQL's
-- own case/parenthesization/whitespace normalization, rather than
-- requiring the migration's own source spelling ("between 1 and 200")
-- to survive storage verbatim. Three separate, individually-provable
-- booleans (rather than one bundled bool_and) so a future regression in
-- any ONE bound is independently diagnosable, not merged into a single
-- opaque false.
check_constraint_check as (
  select
    coalesce(
      reveal_line_con.oid is not null
      and pg_get_constraintdef(reveal_line_con.oid) ~* 'reveal_line\s+is\s+null'
      and pg_get_constraintdef(reveal_line_con.oid) ~* 'char_length\(\s*reveal_line\s*\)\s*<=\s*32',
      false
    ) as reveal_line_bound_correct,
    coalesce(
      back_message_con.oid is not null
      and pg_get_constraintdef(back_message_con.oid) ~*
        'char_length\(\s*trim\(\s*both\s+from\s+back_message\s*\)\s*\)\s*>=\s*1',
      false
    ) as back_message_lower_bound_correct,
    coalesce(
      back_message_con.oid is not null
      and pg_get_constraintdef(back_message_con.oid) ~*
        'char_length\(\s*trim\(\s*both\s+from\s+back_message\s*\)\s*\)\s*<=\s*200',
      false
    ) as back_message_upper_bound_correct
  from (select 1 as anchor) _anchor
  left join pg_constraint reveal_line_con
    on reveal_line_con.conname = 'dispatch_postcards_reveal_line_length'
    and reveal_line_con.conrelid = to_regclass('public.dispatch_postcards')
    and reveal_line_con.contype = 'c'
  left join pg_constraint back_message_con
    on back_message_con.conname = 'dispatch_postcards_back_message_length'
    and back_message_con.conrelid = to_regclass('public.dispatch_postcards')
    and back_message_con.contype = 'c'
),
-- RLS: authenticated may SELECT only when the underlying Dispatch
-- resolves through public.dispatches (which carries its own live RLS —
-- see the migration's own comment for why this delegation is safe and
-- correct, unlike a hypothetical direct query against public.letters).
-- VERIFIER FIX (final pre-Supabase review, live-diagnostic-driven): the
-- migration is LIVE and unchanged by this pass — the original pattern
-- required a literal `public.` schema qualifier immediately before
-- `dispatches`, but PostgreSQL's own catalog-stored/pretty-printed
-- pg_get_expr output omits the schema qualifier for an unambiguous
-- relation name (confirmed live: `FROM dispatches d`, not `FROM
-- public.dispatches d`) — not a real defect. The qualifier is now
-- optional, but this must never weaken into merely finding the bare
-- word "dispatches" somewhere in the policy: TWO separate proofs are
-- still required — (1) the EXISTS/SELECT/FROM/alias shape delegating
-- through a `dispatches d` relation, and (2) the actual join
-- correlation tying that relation's own id to dispatch_postcards'
-- dispatch_id (`d.id = dispatch_postcards.dispatch_id`), which is what
-- makes this a genuine per-row visibility check rather than a bare
-- unconditional EXISTS.
policy_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(
      pg_get_expr(pol.polqual, pol.polrelid) ~* 'exists\s*\(\s*select\s+1\s*from\s+(public\.)?dispatches\s+d'
      and pg_get_expr(pol.polqual, pol.polrelid) ~* 'd\.id\s*=\s*dispatch_postcards\.dispatch_id',
      false
    ) as delegates_through_dispatches
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'dispatch_postcards_select_visible'
    and pol.polrelid = to_regclass('public.dispatch_postcards')
),
-- Table itself: SELECT only to authenticated, nothing at all to anon —
-- and critically NO direct INSERT/UPDATE/DELETE grant to EITHER role.
grant_check as (
  select
    case when to_regclass('public.dispatch_postcards') is null then false
      else has_table_privilege('authenticated', 'public.dispatch_postcards', 'SELECT') end as authenticated_select,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_postcards', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_postcards', 'UPDATE') end as authenticated_no_update,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_postcards', 'DELETE') end as authenticated_no_delete,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('anon', 'public.dispatch_postcards', 'SELECT') end as anon_no_select,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('anon', 'public.dispatch_postcards', 'INSERT') end as anon_no_insert,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('anon', 'public.dispatch_postcards', 'UPDATE') end as anon_no_update,
    case when to_regclass('public.dispatch_postcards') is null then false
      else not has_table_privilege('anon', 'public.dispatch_postcards', 'DELETE') end as anon_no_delete,
    -- Security requirement: this migration must NOT grant anon SELECT on
    -- the existing Postcard catalogue tables either.
    not has_table_privilege('anon', 'public.postcard_catalog', 'SELECT') as anon_no_select_catalog,
    not has_table_privilege('anon', 'public.postcard_versions', 'SELECT') as anon_no_select_versions,
    -- letter_postcards' own privacy model must remain completely
    -- untouched by this migration.
    not has_table_privilege('anon', 'public.letter_postcards', 'SELECT') as anon_no_select_letter_postcards,
    has_table_privilege('authenticated', 'public.letter_postcards', 'SELECT') as authenticated_still_selects_letter_postcards
),
-- publish_dispatch — the sole write path. Joined against the EXACT oid
-- to_regprocedure resolves for the NEW 5-arg signature, so a stale 4-arg
-- overload left behind by a botched migration would show as "exact
-- signature does not exist" rather than a false pass.
publish_check as (
  select
    to_regprocedure('public.publish_dispatch(text, text, text[], jsonb, jsonb)') is not null as exact_signature_exists,
    -- The OLD 4-arg signature must be genuinely gone, not merely
    -- shadowed — a stale overload left callable would be a real "stale
    -- executable overload" regression.
    to_regprocedure('public.publish_dispatch(text, text, text[], jsonb)') is null as old_signature_removed,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'),
      false
    ) as search_path_fixed,
    coalesce(pg_get_functiondef(p.oid) ilike '%p_postcard is not null%', false) as postcard_is_optional,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%from public.postcard_catalog%where key = v_postcard_key and is_active%',
      false
    ) as requires_active_catalogue_entry,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%from public.postcard_versions%where postcard_key = v_postcard_key and is_current%',
      false
    ) as resolves_current_version_server_side,
    coalesce(pg_get_functiondef(p.oid) ilike '%back message is too long%', false) as validates_back_message_length,
    coalesce(pg_get_functiondef(p.oid) ilike '%reveal line is too long%', false) as validates_reveal_line_length,
    coalesce(pg_get_functiondef(p.oid) ilike '%sender_pseudonym_snapshot%', false) as snapshots_pseudonym,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%insert into public.dispatch_postcards%',
      false
    ) as inserts_dispatch_postcards_in_publish_path,
    -- The dispatch_postcards INSERT must occur strictly AFTER the
    -- dispatches INSERT (needs new_id) — both positions proven > 0
    -- before comparing, same IMPORTANT-correction discipline as every
    -- other position() check in this codebase's verifiers.
    coalesce(
      position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid)) > 0
      and position('insert into public.dispatch_postcards' in pg_get_functiondef(p.oid)) > 0
      and position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid))
        < position('insert into public.dispatch_postcards' in pg_get_functiondef(p.oid)),
      false
    ) as postcard_insert_after_dispatch_insert,
    -- Final pre-Supabase review — SECURITY DEFINER proof, part 1: this
    -- migration deliberately converts publish_dispatch from SECURITY
    -- INVOKER to SECURITY DEFINER (see the migration's own header for
    -- why); the function's own code, not RLS, becomes the sole trust
    -- boundary for who it writes author_id as. The strongest available
    -- proof it accepts no caller-supplied author/user identity at all is
    -- that its identity argument list contains no `uuid` parameter
    -- whatsoever (checked via pg_get_function_identity_arguments — the
    -- fixed-signature catalog text, not a parameter-NAME guess that a
    -- differently-named uuid parameter could quietly slip past).
    coalesce(pg_get_function_identity_arguments(p.oid) not ilike '%uuid%', false)
      as no_caller_supplied_author_uuid_argument,
    -- Final pre-Supabase review — SECURITY DEFINER proof, part 2: proves
    -- the Dispatch INSERT's author_id column is populated from
    -- auth.uid() itself, not any parameter — the exact authoritative
    -- insert path (`insert into public.dispatches (author_id, ...)
    -- values (auth.uid(), ...)`). Both literal fragments' positions are
    -- proven > 0 (genuinely found) before the ordering comparison, same
    -- discipline as postcard_insert_after_dispatch_insert above and
    -- every other position() check in this codebase's verifiers — never
    -- a bare comparison that could pass on a false premise (position()
    -- returns 0, not NULL, for a missing substring).
    coalesce(
      position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid)) > 0
      and position('values (auth.uid(), p_title, p_body, ''published'', now())' in pg_get_functiondef(p.oid)) > 0
      and position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid))
        < position('values (auth.uid(), p_title, p_body, ''published'', now())' in pg_get_functiondef(p.oid)),
      false
    ) as dispatch_insert_derives_author_id_from_auth_uid,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.publish_dispatch(text, text, text[], jsonb, jsonb)')
),
-- update_dispatch must NOT have been extended for Postcard mutation —
-- proven two ways: its signature still has exactly the authoritative
-- FIVE arguments (p_dispatch_id uuid, p_title text, p_body text,
-- p_topics text[], p_moments jsonb — no SIX-argument Postcard overload
-- exists), AND its function body (whatever its current signature/
-- definition is) never references p_postcard or dispatch_postcards at
-- all. VERIFIER FIX (final pre-Supabase review): the alias names below
-- were previously "four_arg_signature_still_authoritative"/
-- "no_postcard_overload_exists", which miscounted update_dispatch's own
-- argument list — its authoritative signature has always been FIVE
-- arguments (p_dispatch_id is the first), not four, so the prohibited
-- hypothetical Postcard overload is SIX arguments, not five. The actual
-- to_regprocedure signatures being checked are unchanged — only the
-- alias names/comments are corrected to match them.
update_dispatch_check as (
  select
    to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)') is not null
      as five_arg_signature_still_authoritative,
    to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb, jsonb)') is null
      as no_six_arg_postcard_overload_exists,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%p_postcard%'), true) as body_never_references_p_postcard,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%dispatch_postcards%'), true) as body_never_touches_dispatch_postcards
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)')
),
-- get_shared_dispatch — the sole anon-facing read path. Joined against
-- the EXACT oid for the WIDENED 9-column return shape (dispatch_id,
-- title, body, published_at, author_pseudonym, author_country, topics,
-- moments, postcard) via its fixed argument signature (return-type
-- changes don't affect to_regprocedure's argument-based resolution, so
-- this still finds the one live function regardless of its RETURNS
-- TABLE shape).
shared_check as (
  select
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'),
      false
    ) as search_path_fixed,
    -- The security gate must be byte-for-byte unchanged.
    coalesce(pg_get_functiondef(p.oid) ilike '%ds.revoked_at is null%', false) as checks_revoked_at,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.status = ''published''%', false) as checks_status_published,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.moderation_status = ''visible''%', false) as checks_moderation_visible,
    -- Never returns author_id or any other private/member-only field —
    -- the function's own RETURNS TABLE column list is the authority
    -- here; author_id/user_id must not appear as an output column name
    -- (proargnames holds both input arg names and RETURNS TABLE column
    -- names together; p_token is the only real input, so a bare
    -- 'author_id'/'user_id' match can only ever be an output column).
    coalesce(
      not (p.proargnames @> array['author_id']::text[] or p.proargnames @> array['user_id']::text[]),
      true
    ) as never_declares_author_id_output,
    -- Returns the resolved Postcard fields as a single bundled jsonb
    -- column (mirrors the existing `moments jsonb` convention) — proven
    -- by the RETURNS TABLE clause itself carrying `postcard jsonb`.
    coalesce(pg_get_functiondef(p.oid) ilike '%postcard jsonb%', false) as declares_postcard_output_column,
    coalesce(pg_get_functiondef(p.oid) ilike '%from public.dispatch_postcards dp%', false)
      as resolves_postcard_from_dispatch_postcards,
    coalesce(pg_get_functiondef(p.oid) ilike '%join public.postcard_versions pv on pv.id = dp.postcard_version_id%', false)
      as joins_through_frozen_version,
    -- Must never select postcard_key/postcard_version_id/any internal id
    -- into the jsonb payload handed to an anonymous caller.
    coalesce(not (pg_get_functiondef(p.oid) ilike '%''postcard_version_id''%'), true)
      as never_exposes_internal_version_id,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_can_execute,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_can_execute
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.get_shared_dispatch(uuid)')
),
-- No denormalized Postcard data was added directly to public.dispatches
-- itself — the association lives entirely in the sibling table.
no_denormalization_check as (
  select
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatches' and column_name ilike '%postcard%'
    ) as no_postcard_column_on_dispatches
)
select
  t.table_exists,
  t.rls_enabled,
  col.all_columns_present,
  pk.dispatch_id_is_sole_pk,
  fk.all_fks_correct,
  cc.reveal_line_bound_correct,
  cc.back_message_lower_bound_correct,
  cc.back_message_upper_bound_correct,
  pol.exists_at_all as policy_exists,
  pol.delegates_through_dispatches,
  g.authenticated_select,
  g.authenticated_no_insert,
  g.authenticated_no_update,
  g.authenticated_no_delete,
  g.anon_no_select,
  g.anon_no_insert,
  g.anon_no_update,
  g.anon_no_delete,
  g.anon_no_select_catalog,
  g.anon_no_select_versions,
  g.anon_no_select_letter_postcards,
  g.authenticated_still_selects_letter_postcards,
  pub.exact_signature_exists as publish_exact_signature_exists,
  pub.old_signature_removed as publish_old_signature_removed,
  pub.exists_at_all as publish_exists,
  pub.is_security_definer as publish_is_security_definer,
  pub.search_path_fixed as publish_search_path_fixed,
  pub.postcard_is_optional,
  pub.requires_active_catalogue_entry,
  pub.resolves_current_version_server_side,
  pub.validates_back_message_length,
  pub.validates_reveal_line_length,
  pub.snapshots_pseudonym,
  pub.inserts_dispatch_postcards_in_publish_path,
  pub.postcard_insert_after_dispatch_insert,
  pub.no_caller_supplied_author_uuid_argument,
  pub.dispatch_insert_derives_author_id_from_auth_uid,
  pub.authenticated_exec as publish_authenticated_exec,
  pub.anon_no_exec as publish_anon_no_exec,
  upd.five_arg_signature_still_authoritative,
  upd.no_six_arg_postcard_overload_exists,
  upd.body_never_references_p_postcard,
  upd.body_never_touches_dispatch_postcards,
  sh.exists_at_all as shared_exists,
  sh.is_security_definer as shared_is_security_definer,
  sh.search_path_fixed as shared_search_path_fixed,
  sh.checks_revoked_at,
  sh.checks_status_published,
  sh.checks_moderation_visible,
  sh.never_declares_author_id_output,
  sh.declares_postcard_output_column,
  sh.resolves_postcard_from_dispatch_postcards,
  sh.joins_through_frozen_version,
  sh.never_exposes_internal_version_id,
  sh.anon_can_execute as shared_anon_can_execute,
  sh.authenticated_can_execute as shared_authenticated_can_execute,
  nd.no_postcard_column_on_dispatches,
  (
    t.table_exists and t.rls_enabled
    and col.all_columns_present
    and pk.dispatch_id_is_sole_pk
    and fk.all_fks_correct
    and cc.reveal_line_bound_correct
    and cc.back_message_lower_bound_correct
    and cc.back_message_upper_bound_correct
    and pol.exists_at_all and pol.delegates_through_dispatches
    and g.authenticated_select and g.authenticated_no_insert and g.authenticated_no_update and g.authenticated_no_delete
    and g.anon_no_select and g.anon_no_insert and g.anon_no_update and g.anon_no_delete
    and g.anon_no_select_catalog and g.anon_no_select_versions
    and g.anon_no_select_letter_postcards and g.authenticated_still_selects_letter_postcards
    and pub.exact_signature_exists and pub.old_signature_removed and pub.exists_at_all
    and pub.is_security_definer and pub.search_path_fixed
    and pub.postcard_is_optional and pub.requires_active_catalogue_entry
    and pub.resolves_current_version_server_side and pub.validates_back_message_length
    and pub.validates_reveal_line_length and pub.snapshots_pseudonym
    and pub.inserts_dispatch_postcards_in_publish_path and pub.postcard_insert_after_dispatch_insert
    and pub.no_caller_supplied_author_uuid_argument and pub.dispatch_insert_derives_author_id_from_auth_uid
    and pub.authenticated_exec and pub.anon_no_exec
    and upd.five_arg_signature_still_authoritative and upd.no_six_arg_postcard_overload_exists
    and upd.body_never_references_p_postcard and upd.body_never_touches_dispatch_postcards
    and sh.exists_at_all and sh.is_security_definer and sh.search_path_fixed
    and sh.checks_revoked_at and sh.checks_status_published and sh.checks_moderation_visible
    and sh.never_declares_author_id_output and sh.declares_postcard_output_column
    and sh.resolves_postcard_from_dispatch_postcards and sh.joins_through_frozen_version
    and sh.never_exposes_internal_version_id
    and sh.anon_can_execute and sh.authenticated_can_execute
    and nd.no_postcard_column_on_dispatches
  ) as overall_pass
from table_check t, column_check col, pk_check pk, fk_check fk, check_constraint_check cc,
     policy_check pol, grant_check g, publish_check pub, update_dispatch_check upd,
     shared_check sh, no_denormalization_check nd;


-- ============================================================
-- DETAIL — full source of the new/changed objects, for manual reading
-- alongside the migration file itself.
-- ============================================================
select pg_get_expr(pol.polqual, pol.polrelid) as dispatch_postcards_select_visible_using_clause
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname = 'dispatch_postcards' and pol.polname = 'dispatch_postcards_select_visible';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'publish_dispatch';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_shared_dispatch';

-- Live data spot-check (safe to run even with zero rows): confirms no
-- Dispatch has ever accumulated more than one Postcard — the primary
-- key already guarantees this structurally, this simply proves no
-- historical data violates it.
select
  count(*) as total_rows,
  count(*) filter (
    where dispatch_id in (
      select dispatch_id from public.dispatch_postcards
      group by dispatch_id having count(*) > 1
    )
  ) as impossible_duplicate_postcards
from public.dispatch_postcards;

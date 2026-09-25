-- ============================================================
-- TEMPA — OFFICIAL / SPONSORED DISPATCHES VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-15-official-sponsored-dispatches.sql.
-- SELECTs only; changes nothing. Expect one row, overall_pass = true.
-- ============================================================

with col as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatches' and column_name = 'published_as'
        and data_type = 'text' and is_nullable = 'NO' and column_default like '''member''%'
    ) as published_as_column_ok,
    (select count(*) = 3 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatches'
        and column_name in ('sponsor_name', 'sponsor_cta_label', 'sponsor_cta_url')) as sponsor_columns_ok
),
cons as (
  select
    coalesce(bool_or(conname = 'dispatches_published_as_check' and convalidated), false) as published_as_check_ok,
    coalesce(bool_or(conname = 'dispatches_sponsor_shape' and convalidated
      and pg_get_constraintdef(oid) ilike '%sponsor_name IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%sponsor_cta_url IS NULL%'), false) as sponsor_shape_ok,
    coalesce(bool_or(conname = 'dispatches_sponsor_cta_url_https' and convalidated
      and pg_get_constraintdef(oid) ilike '%^https://%'), false) as cta_https_only
  from pg_constraint
  where conrelid = 'public.dispatches'::regclass
),
rows_ok as (
  -- every row is one of the three identities; every non-member row was
  -- created by an admin; no member/tempa row carries sponsor metadata
  select
    not exists (select 1 from public.dispatches where published_as not in ('member', 'tempa', 'sponsored')) as identities_valid,
    not exists (
      select 1 from public.dispatches d
      where d.published_as <> 'member'
        and not exists (select 1 from public.staff_roles sr where sr.user_id = d.author_id and sr.role = 'admin')
    ) as non_member_rows_by_admins,
    not exists (
      select 1 from public.dispatches
      where published_as <> 'sponsored'
        and (sponsor_name is not null or sponsor_cta_label is not null or sponsor_cta_url is not null)
    ) as no_spoofed_sponsor_metadata
),
trg as (
  select exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.dispatches'::regclass
      and t.tgname = 'dispatches_publication_identity_guard'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) as identity_trigger_enabled,
  coalesce((
    select pg_get_functiondef(p.oid) ilike '%sr.role = ''admin''%'
      and pg_get_functiondef(p.oid) ilike '%new.published_as is distinct from old.published_as%'
    from pg_proc p where p.oid = to_regprocedure('tempa_private.dispatches_publication_identity_guard()')
  ), false) as trigger_requires_admin_and_immutability
),
fns as (
  select
    to_regprocedure('public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)') as member_publish,
    to_regprocedure('public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean)') as member_update,
    to_regprocedure('public.publish_official_dispatch(text, text, text, text[], jsonb, jsonb, text, text, text)') as official_publish,
    to_regprocedure('public.update_official_dispatch(uuid, text, text, text[], jsonb, text, text, text)') as official_update,
    to_regprocedure('public.get_shared_dispatch(uuid)') as shared
),
fn_checks as (
  select
    f.member_publish is not null and f.official_publish is not null
      and f.official_update is not null and f.shared is not null as functions_present,
    -- member path: cannot choose an identity; still consumes Safety;
    -- Postcard sender is still the member's own pseudonym
    not (pg_get_functiondef(f.member_publish) ilike '%published_as%') as member_publish_has_no_identity_choice,
    pg_get_functiondef(f.member_publish) ilike '%tempa_private.consume_safety_evaluation%' as member_publish_still_safety_checked,
    pg_get_functiondef(f.member_publish) ilike '%from public.profiles%where id = auth.uid()%' as member_postcard_sender_is_pseudonym,
    -- official path: staff check is the first gate, before any insert
    position('public.is_staff(''admin'')' in pg_get_functiondef(f.official_publish)) > 0
      and position('public.is_staff(''admin'')' in pg_get_functiondef(f.official_publish))
        < position('insert into public.dispatches' in pg_get_functiondef(f.official_publish)) as official_publish_staff_gated,
    pg_get_functiondef(f.official_update) ilike '%public.is_staff(''admin'')%'
      and pg_get_functiondef(f.official_update) ilike '%d.author_id = auth.uid()%' as official_update_staff_gated,
    pg_get_functiondef(f.official_publish) ilike '%p_published_as not in (''tempa'', ''sponsored'')%' as official_publish_never_member,
    pg_get_functiondef(f.official_publish) ilike '%v_sender := ''Tempa''%'
      and pg_get_functiondef(f.official_publish) ilike '%v_sender := v_sponsor_name%'
      and not (pg_get_functiondef(f.official_publish) ilike '%from public.profiles%') as official_postcard_sender_resolved,
    pg_get_functiondef(f.official_publish) ilike '%A Sponsored Dispatch needs a sponsor name.%' as sponsored_requires_name,
    -- anonymous share reader: identity from published_as, never author_id
    pg_get_functiondef(f.shared) ilike '%when ''tempa'' then ''Tempa''%'
      and pg_get_functiondef(f.shared) ilike '%when ''sponsored'' then d.sponsor_name%'
      and pg_get_functiondef(f.shared) ilike '%when d.published_as = ''member''%' as shared_identity_resolved,
    not exists (
      select 1 from pg_proc p
      cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) a(name)
      where p.oid = f.shared and a.name = 'author_id'
    ) as shared_never_returns_author_id,
    pg_get_functiondef(f.shared) ilike '%ds.revoked_at is null%'
      and pg_get_functiondef(f.shared) ilike '%d.moderation_status = ''visible''%' as shared_gate_unchanged
  from fns f
),
board_feed as (
  -- board_feed_page: relationship signals gated to member rows; shape,
  -- security mode and keyset ordering unchanged
  select
    coalesce(bf.oid is not null, false) as board_feed_present,
    coalesce(pg_get_functiondef(bf.oid) ilike '%left join familiar_authors fa on fa.author_id = ce.author_id and ce.published_as = ''member''%', false) as board_relationship_member_only,
    coalesce(pg_get_functiondef(bf.oid) ilike '%and d2.published_as = ''member''%', false) as board_augment_member_only,
    coalesce(pg_get_functiondef(bf.oid) ilike '%partition by c.seen_bucket, c.author_id, c.published_as%', false) as board_diversity_isolated,
    coalesce(
      pg_get_function_result(bf.oid) = 'TABLE(id uuid, author_id uuid, title text, body text, published_at timestamp with time zone, moderation_status text, is_kept boolean, is_familiar boolean, seen_bucket smallint, rank_key numeric, seed_hash integer)'
      and not bf.prosecdef
      and pg_get_functiondef(bf.oid) ilike '%order by f.seen_bucket, f.rank_key, f.seed_hash, f.id%',
      false
    ) as board_contract_unchanged,
    coalesce(
      has_function_privilege('authenticated', bf.oid, 'EXECUTE') and not has_function_privilege('anon', bf.oid, 'EXECUTE'),
      false
    ) as board_grants_unchanged
  from (select 1) _a
  left join pg_proc bf on bf.oid = to_regprocedure('public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)')
),
grants as (
  select
    has_function_privilege('authenticated', f.official_publish, 'EXECUTE')
      and has_function_privilege('authenticated', f.official_update, 'EXECUTE') as authenticated_can_call_official,
    not has_function_privilege('anon', f.official_publish, 'EXECUTE')
      and not has_function_privilege('anon', f.official_update, 'EXECUTE') as anon_cannot_mutate,
    has_function_privilege('anon', f.shared, 'EXECUTE') as anon_can_read_shared,
    not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in (f.official_publish, f.official_update, f.shared)
        and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_execute_revoked,
    not has_table_privilege('authenticated', 'public.dispatches', 'INSERT')
      and not has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
      and not has_table_privilege('anon', 'public.dispatches', 'INSERT') as no_direct_dispatch_writes
  from fns f
)
select
  c.published_as_column_ok, c.sponsor_columns_ok,
  k.published_as_check_ok, k.sponsor_shape_ok, k.cta_https_only,
  r.identities_valid, r.non_member_rows_by_admins, r.no_spoofed_sponsor_metadata,
  t.identity_trigger_enabled, t.trigger_requires_admin_and_immutability,
  x.functions_present, x.member_publish_has_no_identity_choice, x.member_publish_still_safety_checked,
  x.member_postcard_sender_is_pseudonym, x.official_publish_staff_gated, x.official_update_staff_gated,
  x.official_publish_never_member, x.official_postcard_sender_resolved, x.sponsored_requires_name,
  x.shared_identity_resolved, x.shared_never_returns_author_id, x.shared_gate_unchanged,
  g.authenticated_can_call_official, g.anon_cannot_mutate, g.anon_can_read_shared,
  g.public_execute_revoked, g.no_direct_dispatch_writes,
  b.board_feed_present, b.board_relationship_member_only, b.board_augment_member_only,
  b.board_diversity_isolated, b.board_contract_unchanged, b.board_grants_unchanged,
  coalesce(
    c.published_as_column_ok and c.sponsor_columns_ok
    and k.published_as_check_ok and k.sponsor_shape_ok and k.cta_https_only
    and r.identities_valid and r.non_member_rows_by_admins and r.no_spoofed_sponsor_metadata
    and t.identity_trigger_enabled and t.trigger_requires_admin_and_immutability
    and x.functions_present and x.member_publish_has_no_identity_choice and x.member_publish_still_safety_checked
    and x.member_postcard_sender_is_pseudonym and x.official_publish_staff_gated and x.official_update_staff_gated
    and x.official_publish_never_member and x.official_postcard_sender_resolved and x.sponsored_requires_name
    and x.shared_identity_resolved and x.shared_never_returns_author_id and x.shared_gate_unchanged
    and g.authenticated_can_call_official and g.anon_cannot_mutate and g.anon_can_read_shared
    and g.public_execute_revoked and g.no_direct_dispatch_writes
    and b.board_feed_present and b.board_relationship_member_only and b.board_augment_member_only
    and b.board_diversity_isolated and b.board_contract_unchanged and b.board_grants_unchanged,
    false
  ) as overall_pass
from col c, cons k, rows_ok r, trg t, fn_checks x, grants g, board_feed b;

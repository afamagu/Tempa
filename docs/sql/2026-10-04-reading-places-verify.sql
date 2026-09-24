-- ============================================================
-- TEMPA — READING PLACES: AUTOMATIC RESUME VERIFICATION
-- Run AFTER 2026-10-04-reading-places.sql has been applied.
-- Read-only verification only.
-- ============================================================

with
table_check as (
  select
    to_regclass('public.reading_places') is not null as table_present,
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'reading_places'
    ), false) as rls_enabled
),
grant_check as (
  select
    case when to_regclass('public.reading_places') is null then false
      else not has_table_privilege('anon', 'public.reading_places', 'SELECT') end as anon_no_select,
    case when to_regclass('public.reading_places') is null then false
      else has_table_privilege('authenticated', 'public.reading_places', 'SELECT') end as authenticated_can_select,
    case when to_regclass('public.reading_places') is null then false
      else has_table_privilege('authenticated', 'public.reading_places', 'INSERT') end as authenticated_can_insert,
    case when to_regclass('public.reading_places') is null then false
      else has_table_privilege('authenticated', 'public.reading_places', 'UPDATE') end as authenticated_can_update,
    case when to_regclass('public.reading_places') is null then false
      else not has_table_privilege('authenticated', 'public.reading_places', 'DELETE') end as authenticated_no_delete
),
policy_check as (
  select
    pol.polname is not null as policy_exists,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id', false) as scoped_to_own_user_id,
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id', false) as with_check_scoped_to_own_user_id
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'reading_places_own'
    and pol.polrelid = to_regclass('public.reading_places')
),
structure_check as (
  select
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.reading_places'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%letter%dispatch%'
    ) as content_type_check_present,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.reading_places'::regclass and contype = 'p'
        and pg_get_constraintdef(oid) ilike '%user_id%'
        and pg_get_constraintdef(oid) ilike '%content_type%'
        and pg_get_constraintdef(oid) ilike '%content_id%'
    ) as composite_primary_key_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reading_places'
        and column_name = 'resume_paragraph_index' and is_nullable = 'YES'
    ) as resume_column_nullable,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reading_places'
        and column_name = 'resume_char_offset' and is_nullable = 'YES'
    ) as resume_char_offset_nullable,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.reading_places'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%resume_char_offset%resume_paragraph_index%'
    ) as resume_offset_needs_index,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reading_places'
        and column_name in ('saved_paragraph_index', 'saved_char_offset', 'saved_at')
    ) as no_deliberate_saved_place_columns
),
no_body_text_check as (
  select not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reading_places'
      and column_name in ('body', 'content', 'text')
  ) as no_content_column
)
select
  t.table_present,
  t.rls_enabled,
  g.anon_no_select,
  g.authenticated_can_select,
  g.authenticated_can_insert,
  g.authenticated_can_update,
  g.authenticated_no_delete,
  p.policy_exists,
  p.scoped_to_own_user_id,
  p.with_check_scoped_to_own_user_id,
  s.content_type_check_present,
  s.composite_primary_key_present,
  s.resume_column_nullable,
  s.resume_char_offset_nullable,
  s.resume_offset_needs_index,
  s.no_deliberate_saved_place_columns,
  nb.no_content_column,
  (
    t.table_present and t.rls_enabled
    and g.anon_no_select and g.authenticated_can_select and g.authenticated_can_insert
    and g.authenticated_can_update and g.authenticated_no_delete
    and p.policy_exists and p.scoped_to_own_user_id and p.with_check_scoped_to_own_user_id
    and s.content_type_check_present and s.composite_primary_key_present
    and s.resume_column_nullable and s.resume_char_offset_nullable
    and s.resume_offset_needs_index and s.no_deliberate_saved_place_columns
    and nb.no_content_column
  ) as overall_pass
from table_check t, grant_check g, policy_check p, structure_check s, no_body_text_check nb;

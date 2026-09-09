-- Tempa — read-only diagnostic for "Discovery returns no answers."
-- Pure SELECT over pg_catalog/pg_policies and the app's own tables. No
-- CREATE/ALTER/DROP/INSERT/UPDATE/DELETE. Deliberately excludes the
-- `body` column of question_answers so no private written content needs
-- to be pasted back — only structural fields.
--
-- Leading hypothesis (see chat): app/question/discover/page.tsx queries
-- `question_answers` directly (not through a view) for OTHER users' rows,
-- using the same anon-key + user-session client every other query in this
-- app uses (lib/supabase/server.ts) — meaning it's subject to whatever
-- Row Level Security policies exist on that table. Every other place in
-- the codebase that touches question_answers only ever reads/writes the
-- CALLER's own rows, so if its RLS policy is the ordinary "select using
-- (user_id = auth.uid())" pattern, Discovery's cross-user read would
-- silently return zero rows regardless of filters or data state — unlike
-- `profiles`, there is no `public_profiles`-style view exposing a safe
-- subset of `question_answers` to everyone. This query checks that,
-- alongside the other candidate causes you listed.

with rls_status as (
  select
    'rls_status' as section, 0 as sort_key,
    jsonb_agg(jsonb_build_object(
      'table', relname,
      'rls_enabled', relrowsecurity,
      'rls_forced', relforcerowsecurity
    ) order by relname) as detail
  from pg_class
  where relname in ('question_answers', 'questions', 'profiles')
    and relnamespace = 'public'::regnamespace
),
rls_policies as (
  select
    'rls_policies' as section, 1 as sort_key,
    jsonb_agg(jsonb_build_object(
      'table', tablename,
      'policy', policyname,
      'command', cmd,
      'roles', roles,
      'using', qual,
      'with_check', with_check
    ) order by tablename, policyname) as detail
  from pg_policies
  where schemaname = 'public'
    and tablename in ('question_answers', 'questions', 'profiles')
),
questions_rows as (
  select
    'questions_rows' as section, 2 as sort_key,
    jsonb_agg(jsonb_build_object(
      'id', id, 'prompt', prompt, 'is_active', is_active, 'created_at', created_at
    ) order by created_at desc) as detail
  from public.questions
),
answers_rows as (
  select
    'question_answers_rows' as section, 3 as sort_key,
    jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'question_id', question_id,
      'is_current', is_current, 'updated_at', updated_at
    ) order by updated_at desc) as detail
  from public.question_answers
),
profile_values as (
  select
    'profile_values' as section, 4 as sort_key,
    jsonb_agg(jsonb_build_object(
      'id', id, 'pseudonym', pseudonym, 'country', country,
      'gender', gender, 'gender_custom', gender_custom, 'age_range', age_range
    )) as detail
  from public.profiles
),
public_profiles_def as (
  select
    'view:public_profiles' as section, 5 as sort_key,
    jsonb_build_object(
      'definition', pg_get_viewdef('public.public_profiles'::regclass, true)
    ) as detail
)
select section, detail from rls_status
union all select section, detail from rls_policies
union all select section, detail from questions_rows
union all select section, detail from answers_rows
union all select section, detail from profile_values
union all select section, detail from public_profiles_def
order by section;

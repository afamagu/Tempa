-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 4: PUBLIC TEXT SURFACES VERIFICATION
-- Run AFTER 2026-10-06-safety-checkpoint4-public-surfaces.sql has been
-- applied (and after 2026-10-03-safety-persistence.sql and 2026-10-05-
-- safety-checkpoint3-letter-wiring.sql). Every statement below is a
-- SELECT/has_*_privilege check — no mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
old_signatures_gone_check as (
  select
    to_regprocedure('public.publish_dispatch(text, text, text[], jsonb, jsonb)') is null as old_publish_dispatch_gone,
    to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)') is null as old_update_dispatch_gone,
    to_regprocedure('public.publish_question_answer(uuid, text)') is null as old_publish_question_answer_gone,
    to_regprocedure('public.create_reply(uuid, text, uuid)') is null as old_create_reply_gone
),
new_signatures_present_check as (
  select
    to_regprocedure('public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)') is not null as publish_dispatch_present,
    to_regprocedure('public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean)') is not null as update_dispatch_present,
    to_regprocedure('public.publish_question_answer(uuid, text, uuid, boolean)') is not null as publish_question_answer_present,
    to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)') is not null as create_reply_present
),
grant_check as (
  select
    has_function_privilege('authenticated', 'public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)', 'EXECUTE') as authenticated_can_publish_dispatch,
    has_function_privilege('authenticated', 'public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean)', 'EXECUTE') as authenticated_can_update_dispatch,
    has_function_privilege('authenticated', 'public.publish_question_answer(uuid, text, uuid, boolean)', 'EXECUTE') as authenticated_can_publish_question_answer,
    has_function_privilege('authenticated', 'public.create_reply(uuid, text, uuid, uuid, boolean)', 'EXECUTE') as authenticated_can_create_reply,
    not has_function_privilege('anon', 'public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)', 'EXECUTE') as anon_cannot_publish_dispatch,
    not has_function_privilege('anon', 'public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean)', 'EXECUTE') as anon_cannot_update_dispatch,
    not has_function_privilege('anon', 'public.publish_question_answer(uuid, text, uuid, boolean)', 'EXECUTE') as anon_cannot_publish_question_answer,
    not has_function_privilege('anon', 'public.create_reply(uuid, text, uuid, uuid, boolean)', 'EXECUTE') as anon_cannot_create_reply
),
consume_function_check as (
  select
    to_regprocedure('tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)') is not null as consume_function_present
),
wiring_semantics_check as (
  select
    coalesce(
      pg_get_functiondef(p1.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p1.oid) ilike '%''dispatch_publish''%',
      false
    ) as publish_dispatch_calls_consume,
    coalesce(
      pg_get_functiondef(p2.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p2.oid) ilike '%''dispatch_update''%',
      false
    ) as update_dispatch_calls_consume,
    coalesce(
      pg_get_functiondef(p3.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p3.oid) ilike '%''question_answer''%',
      false
    ) as publish_question_answer_calls_consume,
    coalesce(
      pg_get_functiondef(p4.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p4.oid) ilike '%''dispatch_reply''%',
      false
    ) as create_reply_calls_consume,
    coalesce(
      pg_get_functiondef(p1.oid) ilike '%gen_random_uuid()%'
        and pg_get_functiondef(p1.oid) ilike '%consume_safety_evaluation%',
      false
    ) as publish_dispatch_generates_id_before_consume,
    coalesce(
      pg_get_functiondef(p4.oid) ilike '%gen_random_uuid()%'
        and pg_get_functiondef(p4.oid) ilike '%consume_safety_evaluation%',
      false
    ) as create_reply_generates_id_before_consume,
    coalesce(
      pg_get_functiondef(p3.oid) ilike '%for update%'
        and pg_get_functiondef(p3.oid) ilike '%consume_safety_evaluation%',
      false
    ) as publish_question_answer_resolves_id_before_consume
  from (select 1 as anchor) _anchor
  left join pg_proc p1 on p1.oid = to_regprocedure('public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)')
  left join pg_proc p2 on p2.oid = to_regprocedure('public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean)')
  left join pg_proc p3 on p3.oid = to_regprocedure('public.publish_question_answer(uuid, text, uuid, boolean)')
  left join pg_proc p4 on p4.oid = to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)')
),
raw_table_bypass_check as (
  select
    not has_table_privilege('authenticated', 'public.dispatches', 'INSERT') as authenticated_cannot_insert_dispatches_directly,
    not has_table_privilege('authenticated', 'public.dispatch_topics', 'INSERT') as authenticated_cannot_insert_dispatch_topics_directly,
    not has_table_privilege('authenticated', 'public.question_answers', 'INSERT') as authenticated_cannot_insert_question_answers_directly,
    not has_table_privilege('authenticated', 'public.dispatch_replies', 'INSERT') as authenticated_cannot_insert_dispatch_replies_directly,
    not has_table_privilege('authenticated', 'public.dispatch_postcards', 'INSERT') as authenticated_cannot_insert_dispatch_postcards_directly,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'dispatches' and policyname = 'dispatches_insert_own'
    ) as dispatches_insert_own_policy_gone,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'dispatch_topics' and policyname = 'dispatch_topics_insert_own'
    ) as dispatch_topics_insert_own_policy_gone,
    has_table_privilege('authenticated', 'public.dispatches', 'SELECT') as authenticated_can_still_read_dispatches,
    has_table_privilege('authenticated', 'public.dispatch_topics', 'SELECT') as authenticated_can_still_read_dispatch_topics
)
select
  os.old_publish_dispatch_gone,
  os.old_update_dispatch_gone,
  os.old_publish_question_answer_gone,
  os.old_create_reply_gone,
  ns.publish_dispatch_present,
  ns.update_dispatch_present,
  ns.publish_question_answer_present,
  ns.create_reply_present,
  g.authenticated_can_publish_dispatch,
  g.authenticated_can_update_dispatch,
  g.authenticated_can_publish_question_answer,
  g.authenticated_can_create_reply,
  g.anon_cannot_publish_dispatch,
  g.anon_cannot_update_dispatch,
  g.anon_cannot_publish_question_answer,
  g.anon_cannot_create_reply,
  cf.consume_function_present,
  ws.publish_dispatch_calls_consume,
  ws.update_dispatch_calls_consume,
  ws.publish_question_answer_calls_consume,
  ws.create_reply_calls_consume,
  ws.publish_dispatch_generates_id_before_consume,
  ws.create_reply_generates_id_before_consume,
  ws.publish_question_answer_resolves_id_before_consume,
  rb.authenticated_cannot_insert_dispatches_directly,
  rb.authenticated_cannot_insert_dispatch_topics_directly,
  rb.authenticated_cannot_insert_question_answers_directly,
  rb.authenticated_cannot_insert_dispatch_replies_directly,
  rb.authenticated_cannot_insert_dispatch_postcards_directly,
  rb.dispatches_insert_own_policy_gone,
  rb.dispatch_topics_insert_own_policy_gone,
  rb.authenticated_can_still_read_dispatches,
  rb.authenticated_can_still_read_dispatch_topics,
  (
    os.old_publish_dispatch_gone and os.old_update_dispatch_gone
    and os.old_publish_question_answer_gone and os.old_create_reply_gone
    and ns.publish_dispatch_present and ns.update_dispatch_present
    and ns.publish_question_answer_present and ns.create_reply_present
    and g.authenticated_can_publish_dispatch and g.authenticated_can_update_dispatch
    and g.authenticated_can_publish_question_answer and g.authenticated_can_create_reply
    and g.anon_cannot_publish_dispatch and g.anon_cannot_update_dispatch
    and g.anon_cannot_publish_question_answer and g.anon_cannot_create_reply
    and cf.consume_function_present
    and ws.publish_dispatch_calls_consume and ws.update_dispatch_calls_consume
    and ws.publish_question_answer_calls_consume and ws.create_reply_calls_consume
    and ws.publish_dispatch_generates_id_before_consume and ws.create_reply_generates_id_before_consume
    and ws.publish_question_answer_resolves_id_before_consume
    and rb.authenticated_cannot_insert_dispatches_directly and rb.authenticated_cannot_insert_dispatch_topics_directly
    and rb.authenticated_cannot_insert_question_answers_directly and rb.authenticated_cannot_insert_dispatch_replies_directly
    and rb.authenticated_cannot_insert_dispatch_postcards_directly
    and rb.dispatches_insert_own_policy_gone and rb.dispatch_topics_insert_own_policy_gone
    and rb.authenticated_can_still_read_dispatches and rb.authenticated_can_still_read_dispatch_topics
  ) as overall_pass
from old_signatures_gone_check os, new_signatures_present_check ns, grant_check g,
     consume_function_check cf, wiring_semantics_check ws, raw_table_bypass_check rb;

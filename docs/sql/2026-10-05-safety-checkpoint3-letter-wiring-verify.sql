-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 3: LETTER MUTATION WIRING VERIFICATION
-- Run AFTER 2026-10-05-safety-checkpoint3-letter-wiring.sql has been
-- applied (and after 2026-10-03-safety-persistence.sql). Every
-- statement below is a SELECT/has_*_privilege check — no mutation of
-- any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
old_signatures_gone_check as (
  select
    to_regprocedure('public.send_first_letter(uuid, uuid, text)') is null as old_send_first_letter_gone,
    to_regprocedure('public.write_letter(uuid, text, uuid, jsonb, jsonb)') is null as old_write_letter_gone,
    to_regprocedure('public.reply_to_letter(uuid, text, jsonb, jsonb)') is null as old_reply_to_letter_gone
),
new_signatures_present_check as (
  select
    to_regprocedure('public.send_first_letter(uuid, uuid, text, uuid, boolean)') is not null as send_first_letter_present,
    to_regprocedure('public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean)') is not null as write_letter_present,
    to_regprocedure('public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)') is not null as reply_to_letter_present
),
grant_check as (
  select
    has_function_privilege('authenticated', 'public.send_first_letter(uuid, uuid, text, uuid, boolean)', 'EXECUTE') as authenticated_can_send_first_letter,
    has_function_privilege('authenticated', 'public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean)', 'EXECUTE') as authenticated_can_write_letter,
    has_function_privilege('authenticated', 'public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)', 'EXECUTE') as authenticated_can_reply_to_letter,
    not has_function_privilege('anon', 'public.send_first_letter(uuid, uuid, text, uuid, boolean)', 'EXECUTE') as anon_cannot_send_first_letter,
    not has_function_privilege('anon', 'public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean)', 'EXECUTE') as anon_cannot_write_letter,
    not has_function_privilege('anon', 'public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)', 'EXECUTE') as anon_cannot_reply_to_letter
),
consume_function_check as (
  -- Checkpoint 10B live-verification correction: this checkpoint's own
  -- migration never redefines consume_safety_evaluation itself — it only
  -- calls it — so its real signature is whatever docs/sql/2026-10-03-
  -- safety-persistence.sql currently defines (12 arguments, widened by
  -- Checkpoint 4/5's own additions folded into that file in place). The
  -- stale 9-argument form below predates those widenings and no longer
  -- resolves to anything in production.
  select
    to_regprocedure('tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)') is not null as consume_function_present,
    not has_function_privilege('authenticated', 'tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)', 'EXECUTE') as authenticated_cannot_call_consume,
    not has_function_privilege('anon', 'tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)', 'EXECUTE') as anon_cannot_call_consume,
    not has_function_privilege('service_role', 'tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)', 'EXECUTE') as service_role_not_specifically_granted_consume
),
wiring_semantics_check as (
  select
    coalesce(
      pg_get_functiondef(p1.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p1.oid) ilike '%''first_letter''%',
      false
    ) as send_first_letter_calls_consume,
    coalesce(
      pg_get_functiondef(p2.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p2.oid) ilike '%''write_anytime''%',
      false
    ) as write_letter_calls_consume,
    coalesce(
      pg_get_functiondef(p3.oid) ilike '%tempa_private.consume_safety_evaluation(%'
        and pg_get_functiondef(p3.oid) ilike '%''reply''%',
      false
    ) as reply_to_letter_calls_consume,
    coalesce(pg_get_functiondef(p1.oid) ilike '%char_length(p_body) > 2000%', false) as send_first_letter_has_length_cap,
    coalesce(pg_get_functiondef(p2.oid) not ilike '%char_length(p_body)%2000%', true) as write_letter_has_no_2000_cap,
    coalesce(pg_get_functiondef(p3.oid) not ilike '%char_length(p_body)%2000%', true) as reply_to_letter_has_no_2000_cap
  from (select 1 as anchor) _anchor
  left join pg_proc p1 on p1.oid = to_regprocedure('public.send_first_letter(uuid, uuid, text, uuid, boolean)')
  left join pg_proc p2 on p2.oid = to_regprocedure('public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean)')
  left join pg_proc p3 on p3.oid = to_regprocedure('public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)')
)
select
  os.old_send_first_letter_gone,
  os.old_write_letter_gone,
  os.old_reply_to_letter_gone,
  ns.send_first_letter_present,
  ns.write_letter_present,
  ns.reply_to_letter_present,
  g.authenticated_can_send_first_letter,
  g.authenticated_can_write_letter,
  g.authenticated_can_reply_to_letter,
  g.anon_cannot_send_first_letter,
  g.anon_cannot_write_letter,
  g.anon_cannot_reply_to_letter,
  cf.consume_function_present,
  cf.authenticated_cannot_call_consume,
  cf.anon_cannot_call_consume,
  cf.service_role_not_specifically_granted_consume,
  ws.send_first_letter_calls_consume,
  ws.write_letter_calls_consume,
  ws.reply_to_letter_calls_consume,
  ws.send_first_letter_has_length_cap,
  ws.write_letter_has_no_2000_cap,
  ws.reply_to_letter_has_no_2000_cap,
  (
    os.old_send_first_letter_gone and os.old_write_letter_gone and os.old_reply_to_letter_gone
    and ns.send_first_letter_present and ns.write_letter_present and ns.reply_to_letter_present
    and g.authenticated_can_send_first_letter and g.authenticated_can_write_letter and g.authenticated_can_reply_to_letter
    and g.anon_cannot_send_first_letter and g.anon_cannot_write_letter and g.anon_cannot_reply_to_letter
    and cf.consume_function_present and cf.authenticated_cannot_call_consume and cf.anon_cannot_call_consume
    and cf.service_role_not_specifically_granted_consume
    and ws.send_first_letter_calls_consume and ws.write_letter_calls_consume and ws.reply_to_letter_calls_consume
    and ws.send_first_letter_has_length_cap and ws.write_letter_has_no_2000_cap and ws.reply_to_letter_has_no_2000_cap
  ) as overall_pass
from old_signatures_gone_check os, new_signatures_present_check ns, grant_check g,
     consume_function_check cf, wiring_semantics_check ws;

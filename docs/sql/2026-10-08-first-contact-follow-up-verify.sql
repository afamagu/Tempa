-- Tempa — first-contact follow-up verification.
-- Every boolean must be true.
select
  position('FIRST_CONTACT_FOLLOW_UP_USED' in pg_get_functiondef('public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure)) > 0
    as follow_up_capped,
  position('FIRST_CONTACT_RECIPIENT_PASSED' in pg_get_functiondef('public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure)) > 0
    as explicit_pass_final,
  position('interval ''7 days''' in pg_get_functiondef('public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure)) > 0
    as seven_day_cooldown,
  position('lock_relationship_capacity_pair' in pg_get_functiondef('public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure)) > 0
    as pair_state_serialized,
  position('v_first_contact_attempt_count = 1' in pg_get_functiondef('public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'::regprocedure)) > 0
    as safety_supports_follow_up,
  position('interval ''7 days''' in pg_get_functiondef('public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'::regprocedure)) > 0
    as safety_matches_cooldown;

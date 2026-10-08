-- Tempa — late first-contact reply verification. Every boolean should be true.
select
  pg_get_functiondef('public.reply_to_letter(uuid,text,uuid,jsonb,jsonb,boolean)'::regprocedure)
    ilike '%closed_by = ''system''%' as system_expired_root_is_replyable,
  pg_get_functiondef('public.reply_to_letter(uuid,text,uuid,jsonb,jsonb,boolean)'::regprocedure)
    ilike '%CORRESPONDENCE_ALREADY_OPEN%' as newer_open_episode_is_guarded,
  pg_get_functiondef('public.reply_to_letter(uuid,text,uuid,jsonb,jsonb,boolean)'::regprocedure)
    ilike '%if original.status = ''sent'' then%' as expired_root_stays_closed,
  pg_get_functiondef('public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'::regprocedure)
    ilike '%closed_by = ''system''%' as safety_allows_system_expired_root,
  pg_get_functiondef('tempa_private.enforce_correspondence_establishment_capacity()'::regprocedure)
    ilike '%old.status in (''pending'', ''closed'')%' as capacity_covers_late_reactivation,
  pg_get_functiondef('tempa_private.enforce_correspondence_establishment_capacity()'::regprocedure)
    ilike '%lock_relationship_capacity_pair%' as both_members_locked,
  pg_get_functiondef('tempa_private.capture_relationship_establishment_snapshot()'::regprocedure)
    ilike '%old.status in (''pending'', ''closed'')%' as late_establishment_is_snapshotted;

-- ============================================================
-- TEMPA — PHASE 12: PROFILE REWORK
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- PURPOSE
-- -------
-- Expose exactly the two public relationship signals the writing-first
-- profile needs:
--
--   1. whether the member can receive another first contact right now;
--   2. the member's chosen default writing rhythm, if any.
--
-- This does NOT expose capacity counts, limits, overrides, enforcement
-- state, private correspondence state, or any raw profile row.
--
-- Public reading remains independent of correspondence capacity. This RPC is
-- presentation metadata only; all actual sends remain governed by the existing
-- authoritative first-letter / Safety / capacity RPCs and triggers.
-- ============================================================

begin;

create or replace function public.get_public_profile_correspondence_state(
  p_user_id uuid
)
returns table (
  can_receive_first_contact boolean,
  writing_rhythm text
)
language plpgsql
stable
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_state record;
  v_rhythm text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    return;
  end if;

  -- The curated public profile view remains the visibility boundary. A full
  -- block therefore returns no public profile state rather than creating a new
  -- cross-user oracle.
  if not exists (
    select 1
    from public.public_profiles p
    where p.id = p_user_id
  ) then
    return;
  end if;

  select s.*
  into v_state
  from tempa_private.relationship_capacity_state(p_user_id) s;

  select p.writing_rhythm
  into v_rhythm
  from public.profiles p
  where p.id = p_user_id;

  return query
  select
    v_state.incoming_pending_count < v_state.incoming_pending_limit,
    v_rhythm;
end;
$function$;

revoke all on function public.get_public_profile_correspondence_state(uuid)
  from public, anon;

grant execute on function public.get_public_profile_correspondence_state(uuid)
  to authenticated;

comment on function public.get_public_profile_correspondence_state(uuid) is
  'Authenticated public-profile metadata only: whether a visible member can receive another first contact, plus their chosen default writing rhythm. Exposes no counts or private correspondence state.';

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — EVERY BOOLEAN SHOULD BE TRUE
-- ============================================================

select
  to_regprocedure(
    'public.get_public_profile_correspondence_state(uuid)'
  ) is not null
    as profile_state_rpc_ready,

  has_function_privilege(
    'authenticated',
    'public.get_public_profile_correspondence_state(uuid)',
    'EXECUTE'
  )
    as authenticated_can_read_profile_state,

  not has_function_privilege(
    'anon',
    'public.get_public_profile_correspondence_state(uuid)',
    'EXECUTE'
  )
    as anon_cannot_read_profile_state,

  position(
    'public.public_profiles'
    in pg_get_functiondef(
      'public.get_public_profile_correspondence_state(uuid)'::regprocedure
    )
  ) > 0
    as public_profile_visibility_reused,

  position(
    'tempa_private.relationship_capacity_state'
    in pg_get_functiondef(
      'public.get_public_profile_correspondence_state(uuid)'::regprocedure
    )
  ) > 0
    as canonical_capacity_reused,

  position(
    'incoming_pending_count < v_state.incoming_pending_limit'
    in pg_get_functiondef(
      'public.get_public_profile_correspondence_state(uuid)'::regprocedure
    )
  ) > 0
    as inbound_first_contact_gate_reused,

  position(
    'writing_rhythm'
    in pg_get_functiondef(
      'public.get_public_profile_correspondence_state(uuid)'::regprocedure
    )
  ) > 0
    as rhythm_exposed_without_counts;

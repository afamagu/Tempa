-- ============================================================
-- TEMPA — PHASE 6: RELATIONSHIP LIFECYCLE COMPLETION
-- PREPARED 2026-10-05. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- Completes the finite relationship model introduced in Phases 1–5.
--
-- Invariants completed here:
--   * pending AND active correspondences are both OPEN relationships for
--     discovery purposes; neither participant may be surfaced as someone
--     new to meet while an unresolved first-contact episode exists.
--   * automatic first-contact expiry is root-aware, not correspondence-
--     naive: expiring one crossed root never closes a shared pending episode
--     while another live root remains.
--   * automatic expiry never closes an already-established correspondence,
--     even if a redundant crossed root remains status='sent'.
--   * capacity is released exactly when the final live root in a genuinely
--     pending/unestablished correspondence expires.
--
-- Forward-only. No historical migration is edited. No Safety/RLS, Mail Call,
-- delivery timing, correspondence capacity, or established relationship is
-- weakened or bypassed.
-- ============================================================

begin;

-- Refuse to install against the old two-state lifecycle.
do $prerequisite$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'correspondences'
      and column_name = 'status'
      and column_default = '''pending''::text'
  ) then
    raise exception
      'PREREQUISITE FAILED: Phase 6 requires the pending/active/closed correspondence lifecycle.';
  end if;

  if to_regprocedure('public.expire_stale_first_contacts()') is null
     or to_regprocedure('public.discover_people(text,text,text,integer,integer)') is null
     or to_regprocedure('public.get_member_introductions(integer)') is null
     or to_regprocedure('public.get_familiar_faces(integer)') is null then
    raise exception
      'PREREQUISITE FAILED: one or more lifecycle/discovery RPCs required by Phase 6 are missing.';
  end if;
end
$prerequisite$;


-- ============================================================
-- 1. ROOT-AWARE AUTOMATIC EXPIRY
-- ============================================================
-- Historical expiry treated every root letter as owning its own episode.
-- Crossed first contacts now share one pending correspondence, so expiry must
-- resolve stale roots without closing that shared episode while another live
-- root remains. Established correspondence is never an expiry target.
create or replace function public.expire_stale_first_contacts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_correspondence_id uuid;
  v_locked public.correspondences%rowtype;
  v_changed integer;
  v_expired integer := 0;
begin
  for v_correspondence_id in
    select distinct c.id
    from public.correspondences c
    join public.letters l on l.correspondence_id = c.id
    where c.status = 'pending'
      and c.established_at is null
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at <= now()
    order by c.id
  loop
    -- Serialize against send_first_letter/reply_to_letter for this episode.
    select *
    into v_locked
    from public.correspondences c
    where c.id = v_correspondence_id
    for update;

    -- A reply may have established the episode before this lock was won.
    if not found
       or v_locked.status <> 'pending'
       or v_locked.established_at is not null then
      continue;
    end if;

    update public.letters l
    set
      status = 'closed',
      closed_at = now(),
      closed_by = 'system',
      close_reason = null
    where l.correspondence_id = v_correspondence_id
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at <= now();

    get diagnostics v_changed = row_count;
    v_expired := v_expired + v_changed;

    -- If the opposite crossed root is still live, the pending episode stays
    -- open. Otherwise this is the final unresolved root and capacity releases.
    update public.correspondences c
    set
      status = 'closed',
      closed_at = now()
    where c.id = v_correspondence_id
      and c.status = 'pending'
      and c.established_at is null
      and not exists (
        select 1
        from public.letters live
        where live.correspondence_id = c.id
          and live.reply_to_id is null
          and live.status = 'sent'
          and live.expires_at > now()
      );
  end loop;

  return v_expired;
end;
$function$;

revoke all on function public.expire_stale_first_contacts()
  from public, anon, authenticated;
grant execute on function public.expire_stale_first_contacts() to service_role;

comment on function public.expire_stale_first_contacts() is
  'Phase 6 root-aware expiry: stale pending roots expire independently; crossed episodes survive while another live root remains; established correspondence is never closed by first-contact expiry.';


-- ============================================================
-- 2. DISCOVERY READERS — OPEN MEANS PENDING OR ACTIVE
-- ============================================================
-- Preserve each currently installed function byte-for-byte except for the one
-- obsolete partner predicate. This deliberately avoids re-copying old bodies
-- and accidentally rolling back later Safety/performance refinements.
do $discovery_patch$
declare
  v_signature regprocedure;
  v_definition text;
  v_patched text;
  v_name text;
begin
  foreach v_signature in array array[
    'public.discover_people(text,text,text,integer,integer)'::regprocedure,
    'public.get_member_introductions(integer)'::regprocedure,
    'public.get_familiar_faces(integer)'::regprocedure
  ]
  loop
    v_name := v_signature::text;
    v_definition := pg_get_functiondef(v_signature);

    -- All three current readers use this exact active-partner clause once.
    if position('where c.status = ''active''' in v_definition) = 0 then
      raise exception
        'Phase 6 refused to patch % because its expected active-partner predicate was not found.',
        v_name;
    end if;

    v_patched := replace(
      v_definition,
      'where c.status = ''active''',
      'where c.status in (''pending'', ''active'')'
    );

    if v_patched = v_definition then
      raise exception 'Phase 6 produced no change for %.', v_name;
    end if;

    execute v_patched;
  end loop;
end
$discovery_patch$;

comment on function public.discover_people(text,text,text,integer,integer) is
  'Phase 6: People discovery excludes every open correspondence partner (pending or active), not only established active partners.';
comment on function public.get_member_introductions(integer) is
  'Phase 6: passive introductions exclude every open correspondence partner (pending or active).';
comment on function public.get_familiar_faces(integer) is
  'Phase 6: Familiar Faces excludes every open correspondence partner (pending or active).';

commit;

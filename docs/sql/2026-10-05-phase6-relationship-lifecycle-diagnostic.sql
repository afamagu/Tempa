-- TEMPA — PHASE 6 RELATIONSHIP LIFECYCLE DIAGNOSTIC
-- READ ONLY. Safe to run before/after the Phase 6 migration.
--
-- Confirms lifecycle prerequisites, shows whether discovery readers still
-- exclude only active correspondences, and surfaces pending/established/root
-- anomalies without mutating any production state.

select
  to_regclass('public.correspondences') is not null as correspondences_present,
  to_regclass('public.letters') is not null as letters_present,
  to_regprocedure('public.expire_stale_first_contacts()') is not null as expiry_rpc_present,
  to_regprocedure('public.discover_people(text,text,text,integer,integer)') is not null as discover_people_present,
  to_regprocedure('public.get_member_introductions(integer)') is not null as introductions_present,
  to_regprocedure('public.get_familiar_faces(integer)') is not null as familiar_faces_present,
  to_regprocedure('public.get_relationship_capacity()') is not null as capacity_authority_present;

select
  column_default as correspondence_status_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'correspondences'
  and column_name = 'status';

select
  p.oid::regprocedure::text as function_name,
  pg_get_functiondef(p.oid) like '%c.status in (''pending'', ''active'')%' as excludes_all_open_correspondence,
  pg_get_functiondef(p.oid) like '%where c.status = ''active''%' as still_active_only
from pg_proc p
where p.oid in (
  'public.discover_people(text,text,text,integer,integer)'::regprocedure,
  'public.get_member_introductions(integer)'::regprocedure,
  'public.get_familiar_faces(integer)'::regprocedure
)
order by function_name;

select
  pg_get_functiondef('public.expire_stale_first_contacts()'::regprocedure)
    like '%v_locked.status <> ''pending''%' as expiry_rechecks_pending_under_lock,
  pg_get_functiondef('public.expire_stale_first_contacts()'::regprocedure)
    like '%live.expires_at > now()%' as expiry_preserves_live_crossed_root,
  pg_get_functiondef('public.expire_stale_first_contacts()'::regprocedure)
    like '%v_locked.established_at is not null%' as expiry_refuses_established_episode;

-- State overview.
select
  c.status,
  (c.established_at is not null) as established,
  count(*)::bigint as correspondence_count
from public.correspondences c
group by c.status, (c.established_at is not null)
order by c.status, established;

-- A pending row must never already be established; an active row should be.
select
  count(*) filter (where c.status = 'pending' and c.established_at is not null) as pending_but_established,
  count(*) filter (where c.status = 'active' and c.established_at is null) as active_but_unestablished,
  count(*) filter (where c.status = 'closed' and c.closed_at is null) as closed_without_closed_at
from public.correspondences c;

-- Pending episodes and their live/stale root distribution. Crossed first
-- contacts legitimately produce up to two roots, one per direction.
select
  c.id as correspondence_id,
  count(*) filter (
    where l.reply_to_id is null and l.status = 'sent' and l.expires_at > now()
  ) as live_roots,
  count(*) filter (
    where l.reply_to_id is null and l.status = 'sent' and l.expires_at <= now()
  ) as stale_sent_roots,
  count(*) filter (
    where l.reply_to_id is null and l.status = 'closed'
  ) as closed_roots
from public.correspondences c
left join public.letters l on l.correspondence_id = c.id
where c.status = 'pending'
  and c.established_at is null
group by c.id
order by c.id;

-- Established episodes that still contain a historical sent root are allowed:
-- the correspondence is authoritative and expiry must ignore them. This query
-- makes them visible for verification rather than silently rewriting history.
select
  c.id as correspondence_id,
  count(*) filter (
    where l.reply_to_id is null and l.status = 'sent'
  ) as sent_root_count
from public.correspondences c
join public.letters l on l.correspondence_id = c.id
where c.status = 'active'
  and c.established_at is not null
group by c.id
having count(*) filter (
  where l.reply_to_id is null and l.status = 'sent'
) > 0
order by c.id;

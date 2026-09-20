-- READ-ONLY verification for 2026-09-30-mark-identity-and-admin-member-workspace.sql
-- Every statement below is catalog inspection only. Every returned boolean
-- must be true before the migration is accepted.

-- Exact open-correspondence lifecycle prerequisite. This deliberately guards
-- against restoring the superseded active-only model.
select
  i.relname = 'correspondences_one_open_per_pair' as open_index_named,
  x.indisunique and x.indisvalid and x.indisready and x.indislive as open_index_healthy,
  x.indrelid = 'public.correspondences'::regclass as open_index_on_correspondences,
  x.indnkeyatts = 2
    and pg_catalog.pg_get_indexdef(x.indexrelid, 1, true) = 'participant_low'
    and pg_catalog.pg_get_indexdef(x.indexrelid, 2, true) = 'participant_high'
    as open_index_pair_columns,
  pg_catalog.pg_get_expr(x.indpred, x.indrelid, false)
    = '(status = ANY (ARRAY[''pending''::text, ''active''::text]))'
    as open_index_pending_and_active
from pg_catalog.pg_class i
join pg_catalog.pg_namespace n on n.oid = i.relnamespace
join pg_catalog.pg_index x on x.indexrelid = i.oid
where n.nspname = 'public' and i.relname = 'correspondences_one_open_per_pair';

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'correspondences'
      and column_name = 'status' and column_default = '''pending''::text'
  ) as new_correspondences_start_pending,
  exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.correspondences'::regclass
      and c.conname = 'correspondences_status_check'
      and pg_catalog.pg_get_constraintdef(c.oid, true)
        = 'CHECK (status = ANY (ARRAY[''pending''::text, ''active''::text, ''closed''::text]))'
  ) as correspondence_statuses_exact;

-- Exact signatures and return shapes for every function created or replaced.
select
  pg_catalog.pg_get_function_result('public.get_profile_mark_management_status()'::regprocedure)
    = 'TABLE(mark_id uuid, can_change boolean, next_change_at timestamp with time zone)' as mark_status_shape,
  pg_catalog.pg_get_function_result('public.reserve_profile_mark()'::regprocedure)
    = 'TABLE(mark_id uuid, object_name text, uploaded boolean)' as reserve_shape,
  pg_catalog.pg_get_function_result('public.discard_profile_mark(uuid)'::regprocedure)
    = 'void' as discard_shape,
  pg_catalog.pg_get_function_result('public.finalize_profile_mark(uuid)'::regprocedure)
    = 'uuid' as finalize_shape,
  pg_catalog.pg_get_function_result('public.profile_mark_upload_allowed(text)'::regprocedure)
    = 'boolean' as upload_predicate_shape,
  pg_catalog.pg_get_function_result('public.profile_mark_delete_allowed(text)'::regprocedure)
    = 'boolean' as delete_predicate_shape,
  pg_catalog.pg_get_function_result('public.send_first_letter(uuid,uuid,text)'::regprocedure)
    = 'letters_for_participant' as first_contact_shape,
  pg_catalog.pg_get_function_result('public.get_blocked_profiles()'::regprocedure)
    = 'TABLE(id uuid, pseudonym text, country text, scope text, created_at timestamp with time zone, mark_id uuid)'
    as blocked_profiles_shape,
  pg_catalog.pg_get_function_result(
    'public.admin_list_members(text,text,text,timestamp with time zone,timestamp with time zone,integer,integer)'::regprocedure
  ) = 'TABLE(id uuid, pseudonym text, country text, status text, created_at timestamp with time zone, mark_id uuid)'
    as admin_list_shape,
  pg_catalog.pg_get_function_result('public.admin_get_member(uuid)'::regprocedure)
    = 'TABLE(id uuid, pseudonym text, country text, status text, status_reason text, status_changed_at timestamp with time zone, email text, region text, age_range text, gender text, gender_custom text, languages text[], intent text[], created_at timestamp with time zone, mark_id uuid)'
    as admin_detail_shape,
  pg_catalog.pg_get_function_result('public.admin_send_first_letter(uuid,text)'::regprocedure)
    = 'uuid' as admin_contact_shape;

-- All exposed RPCs are postgres-owned SECURITY DEFINER functions with the
-- hardened search_path. Authenticated has EXECUTE; anon and PUBLIC do not.
with expected(signature) as (values
  ('public.get_profile_mark_management_status()'),
  ('public.reserve_profile_mark()'),
  ('public.discard_profile_mark(uuid)'),
  ('public.finalize_profile_mark(uuid)'),
  ('public.profile_mark_upload_allowed(text)'),
  ('public.profile_mark_delete_allowed(text)'),
  ('public.send_first_letter(uuid,uuid,text)'),
  ('public.get_blocked_profiles()'),
  ('public.admin_list_members(text,text,text,timestamp with time zone,timestamp with time zone,integer,integer)'),
  ('public.admin_get_member(uuid)'),
  ('public.admin_send_first_letter(uuid,text)')
), functions as (
  select e.signature, p.*, r.rolname as owner_name
  from expected e
  join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
  join pg_catalog.pg_roles r on r.oid = p.proowner
)
select
  count(*) = 11 as all_expected_functions_exist,
  bool_and(owner_name = 'postgres') as all_owned_by_postgres,
  bool_and(prosecdef) as all_security_definer,
  bool_and(proconfig @> array['search_path=pg_catalog']) as all_restrict_search_path,
  bool_and(pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')) as authenticated_executes,
  bool_and(not pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')) as anon_cannot_execute,
  bool_and(not exists (
    select 1
    from pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  )) as public_cannot_execute
from functions;

-- Ordinary first contact must use the same pending/active open-episode model
-- as the unique index and Admin contact. It still requires a live Discovery
-- answer, rejects a duplicate root from the same sender, and preserves the
-- existing block, delivery and expiry contracts.
with ordinary_def as (
  select pg_catalog.pg_get_functiondef(
    'public.send_first_letter(uuid,uuid,text)'::regprocedure
  ) as def
)
select
  def ilike '%tempa_private.is_correspondence_blocked_pair(auth.uid(), p_recipient_id)%'
    as ordinary_contact_block_gate,
  def ilike '%public.question_answers qa%qa.id = p_question_answer_id%qa.user_id = p_recipient_id%qa.is_current = true%q.is_active = true%'
    as ordinary_contact_requires_live_discovery_answer,
  def ilike '%on conflict (participant_low, participant_high)%where status = any (array[''pending''::text, ''active''::text])%do nothing%'
    as ordinary_contact_conflict_safe_open_episode_resolution,
  def ilike '%c.status in (''pending'', ''active'')%'
    and def ilike '%v_correspondence_status = ''active'' or v_established_at is not null%'
    as ordinary_contact_pending_reused_active_rejected,
  def ilike '%l.reply_to_id is null%l.sender_id = auth.uid()%using errcode = ''23505''%'
    as ordinary_contact_duplicate_same_sender_rejected,
  def ilike '%v_deliver_at := now()%v_expires_at := v_deliver_at + interval ''72 hours''%'
    as ordinary_contact_delivery_window_preserved,
  def not ilike '%where status = ''active''%do nothing%'
    as ordinary_contact_has_no_active_only_conflict_path
from ordinary_def;

-- Mark replacement behavior: first creation is exempt; replacement is
-- cooled down at reservation and finalization; an already-finalized retry
-- returns before the cooldown check; every lookup remains owner-scoped.
with defs as (
  select
    pg_catalog.pg_get_functiondef('public.reserve_profile_mark()'::regprocedure) as reserve_def,
    pg_catalog.pg_get_functiondef('public.finalize_profile_mark(uuid)'::regprocedure) as finalize_def,
    pg_catalog.pg_get_functiondef('public.profile_mark_upload_allowed(text)'::regprocedure) as upload_def,
    pg_catalog.pg_get_functiondef('public.profile_mark_delete_allowed(text)'::regprocedure) as delete_def
)
select
  reserve_def ilike '%if v_profile.mark_id is not null then%interval ''30 days''%'
    as first_mark_exempt_at_reservation,
  finalize_def ilike '%if v_profile.mark_id is not null then%interval ''30 days''%'
    as first_mark_exempt_at_finalization,
  strpos(finalize_def, 'if v_mark.status = ''active'' and v_profile.mark_id = v_mark.id') > 0
    and strpos(finalize_def, 'if v_mark.status = ''active'' and v_profile.mark_id = v_mark.id')
      < strpos(finalize_def, 'interval ''30 days''') as idempotent_retry_precedes_cooldown,
  reserve_def ilike '%pm.owner_id = auth.uid()%pm.status = ''pending''%'
    and finalize_def ilike '%pm.id = p_mark_id and pm.owner_id = auth.uid()%'
    as reservation_and_finalization_owner_scoped,
  upload_def ilike '%pm.owner_id = auth.uid()%pm.status = ''pending''%'
    and delete_def ilike '%pm.owner_id = auth.uid()%pm.status in (''pending'', ''discarded'')%'
    as storage_predicates_owner_scoped
from defs;

-- The private registry continues to allow at most one recoverable pending and
-- one active Mark per owner.
select
  count(*) filter (
    where i.relname = 'profile_marks_one_pending_per_owner'
      and x.indisunique and x.indisvalid and x.indisready and x.indislive
      and pg_catalog.pg_get_expr(x.indpred, x.indrelid, false) = '(status = ''pending''::text)'
  ) = 1 as one_pending_mark_per_owner,
  count(*) filter (
    where i.relname = 'profile_marks_one_active_per_owner'
      and x.indisunique and x.indisvalid and x.indisready and x.indislive
      and pg_catalog.pg_get_expr(x.indpred, x.indrelid, false) = '(status = ''active''::text)'
  ) = 1 as one_active_mark_per_owner
from pg_catalog.pg_class i
join pg_catalog.pg_namespace n on n.oid = i.relnamespace
join pg_catalog.pg_index x on x.indexrelid = i.oid
where n.nspname = 'public'
  and i.relname in ('profile_marks_one_pending_per_owner', 'profile_marks_one_active_per_owner')
  and x.indrelid = 'public.profile_marks'::regclass;

-- Mark objects remain opaque immutable PNGs. Upload and deletion are the only
-- authenticated Storage write policies; there is no overwrite/update policy.
select
  b.public as bucket_is_public,
  b.file_size_limit = 1048576 as png_limit_is_one_mib,
  b.allowed_mime_types = array['image/png'] as png_only,
  count(*) filter (
    where p.cmd = 'INSERT'
      and coalesce(p.with_check, '') ilike '%profile_mark_upload_allowed%'
  ) = 1 as owner_checked_insert_policy,
  count(*) filter (
    where p.cmd = 'DELETE'
      and coalesce(p.qual, '') ilike '%profile_mark_delete_allowed%'
  ) = 1 as owner_checked_delete_policy,
  count(*) filter (where p.cmd = 'UPDATE') = 0 as no_mark_object_overwrite_policy
from storage.buckets b
left join pg_catalog.pg_policies p
  on p.schemaname = 'storage' and p.tablename = 'objects'
  and p.policyname like 'profile_marks_%'
where b.id = 'profile-marks'
group by b.public, b.file_size_limit, b.allowed_mime_types;

-- Admin first contact follows the ordinary correspondence state machine. It
-- reuses pending crossed-contact episodes, rejects established active ones,
-- allows a new row after closed history, preserves account/block gates and the
-- standard immediate-delivery/72-hour first-contact window, and never records
-- private message text in the audit entry.
with admin_def as (
  select pg_catalog.pg_get_functiondef('public.admin_send_first_letter(uuid,text)'::regprocedure) as def
)
select
  def ilike '%if not public.is_staff()%' as staff_only,
  def ilike '%public.current_account_status()%in (''restricted'', ''suspended'', ''banned'')%'
    as account_status_gate,
  def ilike '%tempa_private.is_correspondence_blocked_pair(auth.uid(), p_member_id)%'
    as scoped_block_gate,
  def ilike '%on conflict (participant_low, participant_high)%where status = any (array[''pending''::text, ''active''::text])%do nothing%'
    as conflict_safe_open_episode_resolution,
  def ilike '%c.status in (''pending'', ''active'')%'
    and def ilike '%v_correspondence_status = ''active'' or v_established_at is not null%'
    as pending_reused_active_rejected,
  def ilike '%l.reply_to_id is null%l.sender_id = auth.uid()%using errcode = ''23505''%'
    as duplicate_same_sender_rejected,
  def not ilike '%question_answers%' and def ilike '%question_answer_id%null%'
    as only_discovery_answer_requirement_exempted,
  def ilike '%v_deliver_at := now()%v_expires_at := v_deliver_at + interval ''72 hours''%'
    as first_contact_delivery_window_preserved,
  def not ilike '%4000%' and def not ilike '%char_length(%'
    as no_admin_specific_body_limit,
  not (split_part(def, 'insert into public.admin_audit_log', 2)
    ilike any (array['%p_body%', '%v_body%', '%''body''%']))
    and def ilike '%jsonb_build_object(''correspondence_id'', v_correspondence_id, ''letter_id'', v_new_id)%'
    as audit_has_identifiers_not_private_body
from admin_def;

-- The ordinary reply path remains the sole establishment transition: replying
-- to a delivered, unexpired first-contact root marks the episode active and
-- records established_at. The Admin RPC does not bypass this path.
with reply_def as (
  select pg_catalog.pg_get_functiondef(
    'public.reply_to_letter(uuid,text,jsonb,jsonb)'::regprocedure
  ) as def
)
select
  def ilike '%id = p_letter_id%recipient_id = auth.uid()%status = ''sent''%deliver_at <= now()%'
    as reply_requires_delivered_recipient_letter,
  def ilike '%reply_to_id is not null%or expires_at > now()%'
    as first_reply_requires_unexpired_root,
  def ilike '%if is_first_reply then%update public.correspondences%status = ''active''%established_at = coalesce(established_at, now())%'
    as first_reply_establishes_correspondence
from reply_def;

-- The migration does not widen staff access to private rows. Existing table
-- RLS remains enabled, staff is not added to participant policies, and the
-- normal live Letters body constraint remains untouched.
select
  c.relrowsecurity as correspondences_rls_enabled,
  l.relrowsecurity as letters_rls_enabled,
  not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('correspondences', 'letters')
      and (coalesce(p.qual, '') ilike '%is_staff%'
        or coalesce(p.with_check, '') ilike '%is_staff%')
  ) as no_staff_private_row_bypass,
  exists (
    select 1
    from pg_catalog.pg_constraint k
    where k.conrelid = 'public.letters'::regclass
      and pg_catalog.pg_get_constraintdef(k.oid, true)
        = 'CHECK (char_length(body) <= 200000)'
  ) as normal_live_letter_limit_unchanged
from pg_catalog.pg_class c
join pg_catalog.pg_namespace cn on cn.oid = c.relnamespace and cn.nspname = 'public'
join pg_catalog.pg_class l on l.relname = 'letters'
join pg_catalog.pg_namespace ln on ln.oid = l.relnamespace and ln.nspname = 'public'
where c.relname = 'correspondences';

-- Participant privacy is structural, not merely the absence of an is_staff
-- substring: require the exact sole SELECT policies and no direct client
-- writes to either private table.
select
  count(*) filter (
    where p.tablename = 'correspondences'
      and p.policyname = 'correspondences_select_participant'
      and p.cmd = 'SELECT'
      and p.qual = '((auth.uid() = participant_low) OR (auth.uid() = participant_high))'
  ) = 1
    and count(*) filter (where p.tablename = 'correspondences') = 1
    as correspondence_policy_is_participant_only,
  count(*) filter (
    where p.tablename = 'letters'
      and p.policyname = 'letters_select_participant'
      and p.cmd = 'SELECT'
      and p.qual = '((auth.uid() = sender_id) OR ((auth.uid() = recipient_id) AND (deliver_at <= now())))'
  ) = 1
    and count(*) filter (where p.tablename = 'letters') = 1
    as letter_policy_is_participant_and_delivery_scoped,
  not pg_catalog.has_table_privilege('authenticated', 'public.correspondences', 'INSERT,UPDATE,DELETE')
    as no_direct_correspondence_writes,
  not pg_catalog.has_table_privilege('authenticated', 'public.letters', 'INSERT,UPDATE,DELETE')
    as no_direct_letter_writes
from pg_catalog.pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('correspondences', 'letters');

-- Direct table mutation remains unavailable; owner/staff changes stay behind
-- the reviewed RPC boundaries.
select
  not pg_catalog.has_table_privilege('authenticated', 'public.profile_marks', 'UPDATE') as no_direct_mark_update,
  not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as no_direct_profile_update;

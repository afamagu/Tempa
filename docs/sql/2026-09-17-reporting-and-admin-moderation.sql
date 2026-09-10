-- ============================================================
-- TEMPA — PRE-BETA MINIMUM SAFETY: REPORTING + ADMIN MODERATION
-- PREPARED 2026-09-17. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
-- ============================================================
--
-- Adds the one missing layer on top of the existing Safety & Trust
-- foundation (docs/sql/2026-09-11-safety-blocking-foundation.sql,
-- 2026-09-12-scoped-blocking-and-fixes.sql): a member-reporting write
-- path, and the account-status/audit-log write path that
-- account_enforcement_state and admin_audit_log have been waiting for
-- since they were first created. Nothing here alters blocking semantics,
-- Postcards, Moments, Dispatch architecture, or letter delivery timing.
--
-- Same convention as every other migration in this codebase: SECURITY
-- DEFINER functions use `set search_path to 'pg_catalog'`, every
-- application object is fully `public.`-qualified, every function gets
-- an explicit `revoke all ... from public` then a targeted `grant
-- execute ... to <role>`, and every RLS policy carries an explicit `to
-- <role>` clause.
--
-- One BEGIN/COMMIT.

begin;

-- ============================================================
-- 1. REPORTS — one table, four target types, staff-only read
-- ============================================================
-- A single discriminated table (target_type + target_id), not four
-- separate tables — per the checkpoint's own instruction. No foreign
-- key on target_id: it points into whichever of profiles/letters/
-- dispatches/moments/dispatch_moments target_type names, and the
-- evidence_snapshot below is what survives even if that row is later
-- edited or deleted. reported_user_id/reporter_user_id are real FKs to
-- auth.users so ON DELETE CASCADE keeps this table consistent if an
-- account is ever removed.
create table public.reports (
  id uuid primary key default gen_random_uuid(),

  reporter_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  reported_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  target_type text not null
    check (target_type in ('profile', 'letter', 'dispatch', 'photo_moment')),

  -- Not a foreign key — see header note above. Evidence is preserved in
  -- evidence_snapshot regardless of what later happens to the row this
  -- id names.
  target_id uuid not null,

  reason text not null
    check (reason in (
      'scam_fraud', 'harassment', 'inappropriate_content',
      'impersonation', 'spam', 'other'
    )),

  -- Trimmed, capped, blank-accepted — see report_content below, which
  -- is the only writer and therefore the only place this is enforced.
  context text,

  -- Whatever is reasonably necessary to investigate THIS specific
  -- target, captured once at report time so a later edit/delete of the
  -- underlying content can never destroy it. Shape depends on
  -- target_type; see report_content's own per-branch comments.
  evidence_snapshot jsonb not null,

  -- The smallest possible status field — not a case-management
  -- workflow, just enough for the queue to distinguish "not yet looked
  -- at" from "looked at." No assignment, no multi-step lifecycle.
  status text not null default 'open'
    check (status in ('open', 'reviewed')),

  created_at timestamptz not null default now(),

  -- Duplicate-abuse protection (smallest V1 rule, per the checkpoint):
  -- one active report per reporter+target. A second attempt from the
  -- same reporter against the same target is rejected by report_content
  -- with a clear message; this constraint is the backstop in case two
  -- concurrent calls ever race past that check.
  constraint reports_reporter_target_unique
    unique (reporter_user_id, target_type, target_id),

  constraint reports_no_self_report
    check (reporter_user_id <> reported_user_id)
);

create index reports_reported_user_id_idx on public.reports (reported_user_id);
create index reports_reporter_user_id_idx on public.reports (reporter_user_id);
create index reports_created_at_idx on public.reports (created_at desc);

alter table public.reports enable row level security;

-- Staff-only read, via is_staff() — an ordinary member (including the
-- reporter themselves) has no way to read this table at all, matching
-- "reporting must never notify/expose status to the reported person"
-- and "reporting is not a queue a member can inspect." grant select is
-- a ceiling only; this policy is the actual filter.
create policy reports_select_staff
  on public.reports
  for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy of any kind, for any role. The only
-- writer is report_content below (SECURITY DEFINER, bypasses RLS as the
-- function owner) and the only status-changer is
-- admin_mark_report_reviewed below (same). An ordinary authenticated
-- member cannot manufacture, read, or alter a report row directly under
-- any circumstance.
revoke all on public.reports from public, anon, authenticated;
grant select on public.reports to authenticated;


-- ============================================================
-- 2. REPORT_CONTENT — the one member-facing reporting write path
-- ============================================================
-- Validates the target itself (existence + the caller's own legitimate
-- access to it), derives reported_user_id and the evidence snapshot
-- entirely server-side — the client supplies only target_type,
-- target_id, reason, and optional context, and can never nominate an
-- arbitrary reported_user_id. Self-reports and duplicates are rejected
-- with a clear message; reporting never notifies the reported member
-- (nothing here touches any notification surface) and is fully separate
-- from blocking (this function never reads or writes blocked_users).
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_context text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_reported_user_id uuid;
  v_evidence jsonb;
  v_context text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment') then
    raise exception 'Unknown report target.';
  end if;

  if p_reason not in (
    'scam_fraud', 'harassment', 'inappropriate_content',
    'impersonation', 'spam', 'other'
  ) then
    raise exception 'Unknown report reason.';
  end if;

  v_context := nullif(trim(both from coalesce(p_context, '')), '');
  if v_context is not null and char_length(v_context) > 500 then
    raise exception 'Explanation is too long.';
  end if;

  v_reported_user_id := null;
  v_evidence := null;


  if p_target_type = 'profile' then

    -- Reported target IS the profile owner. Snapshot only the same
    -- allowlisted fields public_profiles already exposes — nothing
    -- private beyond what any member could already see on that profile.
    select
      p.id,
      jsonb_build_object(
        'pseudonym', p.pseudonym,
        'country', p.country,
        'gender', p.gender,
        'gender_custom', p.gender_custom,
        'age_range', p.age_range
      )
    into v_reported_user_id, v_evidence
    from public.profiles p
    where p.id = p_target_id;

    if v_reported_user_id is null then
      raise exception 'Member not found.';
    end if;


  elsif p_target_type = 'letter' then

    -- Only a genuine participant (sender or recipient) of this exact
    -- letter may report it — never an arbitrary letter id fished from
    -- elsewhere. Reported party is always the letter's sender: reading
    -- your OWN sent letter is not reportable (self-report rejected
    -- below regardless).
    select
      l.sender_id,
      jsonb_build_object(
        'body', l.body,
        'sender_pseudonym', p.pseudonym,
        'letter_created_at', l.created_at
      )
    into v_reported_user_id, v_evidence
    from public.letters l
    join public.profiles p on p.id = l.sender_id
    where l.id = p_target_id
      and (l.sender_id = auth.uid() or l.recipient_id = auth.uid());

    if v_reported_user_id is null then
      raise exception 'Letter not found.';
    end if;


  elsif p_target_type = 'dispatch' then

    -- Any authenticated member may report a currently PUBLISHED
    -- Dispatch (the same visibility a reader already has via
    -- dispatches_select_published) — deliberately not gated to only
    -- "Dispatches this viewer has actually opened," since that tracking
    -- doesn't exist and isn't needed for this check.
    select
      d.author_id,
      jsonb_build_object(
        'title', d.title,
        'body', d.body,
        'author_pseudonym', p.pseudonym,
        'published_at', d.published_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatches d
    join public.profiles p on p.id = d.author_id
    where d.id = p_target_id
      and d.status = 'published';

    if v_reported_user_id is null then
      raise exception 'Dispatch not found.';
    end if;


  elsif p_target_type = 'photo_moment' then

    -- A photo Moment lives in one of two tables depending on origin
    -- (a private letter vs. a published Dispatch) — tried in turn.
    -- Letter photo: caller must be a participant in that letter's own
    -- correspondence (mirrors can_view_letter_photo's own access
    -- boundary, never a general "browse anyone's photos" mechanism).
    select
      l.sender_id,
      jsonb_build_object(
        'image_path', m.image_path,
        'sender_pseudonym', p.pseudonym,
        'source', 'letter',
        'moment_created_at', m.created_at
      )
    into v_reported_user_id, v_evidence
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    join public.profiles p on p.id = l.sender_id
    where m.id = p_target_id
      and m.type = 'photo'
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid());

    if v_reported_user_id is null then
      -- Dispatch photo: same published-only visibility as the dispatch
      -- branch above.
      select
        d.author_id,
        jsonb_build_object(
          'image_path', dm.image_path,
          'sender_pseudonym', p.pseudonym,
          'source', 'dispatch',
          'moment_created_at', dm.created_at
        )
      into v_reported_user_id, v_evidence
      from public.dispatch_moments dm
      join public.dispatches d on d.id = dm.dispatch_id
      join public.profiles p on p.id = d.author_id
      where dm.id = p_target_id
        and d.status = 'published';
    end if;

    if v_reported_user_id is null then
      raise exception 'Photo not found.';
    end if;

  end if;


  if v_reported_user_id = auth.uid() then
    raise exception 'You cannot report your own content.';
  end if;

  if exists (
    select 1 from public.reports
    where reporter_user_id = auth.uid()
      and target_type = p_target_type
      and target_id = p_target_id
  ) then
    raise exception 'You have already reported this.';
  end if;


  insert into public.reports (
    reporter_user_id, reported_user_id, target_type, target_id,
    reason, context, evidence_snapshot
  ) values (
    auth.uid(), v_reported_user_id, p_target_type, p_target_id,
    p_reason, v_context, v_evidence
  );

end;
$function$;

revoke all on function public.report_content(text, uuid, text, text) from public;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- ============================================================
-- 3. ADMIN_SET_ACCOUNT_STATUS — the missing write path
-- ============================================================
-- account_enforcement_state has been readable (own row) and fully wired
-- into ~10 RPCs since Checkpoint 1B, but has had NO write path at all —
-- this is that write path. Staff-only (is_staff(), checked server-side,
-- inside this SECURITY DEFINER function — never a client-side gate).
-- The status update and its audit row are two statements inside the
-- SAME function invocation, which Postgres already runs as a single
-- transaction — an exception raised anywhere above aborts both, so an
-- audit row can never be created without the status change actually
-- landing, and vice versa. Existing enforcement semantics
-- (restricted/suspended/banned, see the letter/Dispatch/photo RPCs in
-- 2026-09-11-safety-blocking-foundation.sql) are not touched or
-- reinterpreted here — this function only ever sets the status column
-- those RPCs already read.
create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_old_status text;
  v_reason text;
  v_actor_pseudonym text;
  v_target_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  if p_status not in ('active', 'restricted', 'suspended', 'banned') then
    raise exception 'Unknown status.';
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if exists (
    select 1
    from public.staff_roles
    where user_id = p_user_id
  ) then
    raise exception 'Staff accounts must be managed separately.';
  end if;

  select status into v_old_status
  from public.account_enforcement_state
  where user_id = p_user_id;

  v_old_status := coalesce(v_old_status, 'active');

  insert into public.account_enforcement_state (
    user_id, status, status_reason, changed_by, changed_at
  ) values (
    p_user_id, p_status, v_reason, auth.uid(), now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        status_reason = excluded.status_reason,
        changed_by = excluded.changed_by,
        changed_at = excluded.changed_at;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();
  select pseudonym into v_target_pseudonym from public.profiles where id = p_user_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot,
    reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'set_account_status',
    'account_status', p_user_id, coalesce(v_target_pseudonym, p_user_id::text),
    v_reason, jsonb_build_object('old_status', v_old_status, 'new_status', p_status)
  );

end;
$function$;

revoke all on function public.admin_set_account_status(uuid, text, text) from public;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;


-- ============================================================
-- 4. ADMIN_AUDIT_LOG — staff read policy
-- ============================================================
-- The table itself and its "no client write path" posture are
-- untouched from 2026-09-11 — this adds only the read side, staff-only,
-- for the admin member-detail screen. Ordinary members still have zero
-- access, and no role can INSERT/UPDATE/DELETE through PostgREST under
-- any circumstance — every write happens only as a side effect inside
-- admin_set_account_status above, which runs as the function owner.
create policy admin_audit_log_select_staff
  on public.admin_audit_log
  for select
  to authenticated
  using (public.is_staff());

grant select on public.admin_audit_log to authenticated;


-- ============================================================
-- 5. ADMIN_MARK_REPORT_REVIEWED — the tiny status flip
-- ============================================================
-- The smallest possible "I've looked at this" signal for the queue —
-- not a workflow, not an assignment, not a resolution outcome. Also
-- writes an audit row, so "who marked what reviewed, when" is
-- reconstructable the same way an account-status change is.
create or replace function public.admin_mark_report_reviewed(
  p_report_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_actor_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if not exists (select 1 from public.reports where id = p_report_id) then
    raise exception 'Report not found.';
  end if;

  update public.reports
  set status = 'reviewed'
  where id = p_report_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'mark_report_reviewed',
    'report', p_report_id
  );

end;
$function$;

revoke all on function public.admin_mark_report_reviewed(uuid) from public;
grant execute on function public.admin_mark_report_reviewed(uuid) to authenticated;


-- ============================================================
-- 6. ADMIN READ RPCs — queue, detail, member search/detail
-- ============================================================
-- Every function below is staff-gated inside its own body (never relying
-- solely on the /admin route's own server-side check) and resolves
-- pseudonyms via a direct join to public.profiles — deliberately NOT
-- public_profiles, which excludes rows across a block the STAFF member
-- happens to personally have; an admin investigating a report must never
-- have a row silently disappear because of the admin's own unrelated
-- block. `stable`-style plpgsql (no `stable` keyword needed since these
-- gate on auth.uid()-derived staff status per call) — each raises a
-- plain 'Not authorized.' for a non-staff caller, matching
-- admin_set_account_status's own wording.

create or replace function public.admin_list_reports(p_limit integer default 50)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  reporter_user_id uuid,
  reporter_pseudonym text,
  reported_user_id uuid,
  reported_pseudonym text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
      r.reporter_user_id, rp.pseudonym, r.reported_user_id, tp.pseudonym
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.reported_user_id
    order by r.created_at desc
    limit least(coalesce(p_limit, 50), 200);
end;
$function$;

revoke all on function public.admin_list_reports(integer) from public;
grant execute on function public.admin_list_reports(integer) to authenticated;


create or replace function public.admin_get_report(p_report_id uuid)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  context text,
  status text,
  evidence_snapshot jsonb,
  created_at timestamptz,
  reporter_user_id uuid,
  reporter_pseudonym text,
  reported_user_id uuid,
  reported_pseudonym text,
  reported_current_status text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      r.id, r.target_type, r.target_id, r.reason, r.context, r.status,
      r.evidence_snapshot, r.created_at,
      r.reporter_user_id, rp.pseudonym, r.reported_user_id, tp.pseudonym,
      coalesce(aes.status, 'active')
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.reported_user_id
    left join public.account_enforcement_state aes on aes.user_id = r.reported_user_id
    where r.id = p_report_id;
end;
$function$;

revoke all on function public.admin_get_report(uuid) from public;
grant execute on function public.admin_get_report(uuid) to authenticated;


create or replace function public.admin_search_members(p_query text)
returns table (
  id uuid,
  pseudonym text,
  country text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if char_length(trim(both from coalesce(p_query, ''))) = 0 then
    return;
  end if;

  return query
    select p.id, p.pseudonym, p.country
    from public.profiles p
    where p.pseudonym ilike '%' || trim(both from p_query) || '%'
    order by p.pseudonym
    limit 25;
end;
$function$;

revoke all on function public.admin_search_members(text) from public;
grant execute on function public.admin_search_members(text) to authenticated;


create or replace function public.admin_get_member(p_user_id uuid)
returns table (
  id uuid,
  pseudonym text,
  country text,
  status text,
  status_reason text,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      p.id, p.pseudonym, p.country,
      coalesce(aes.status, 'active'), aes.status_reason, aes.changed_at
    from public.profiles p
    left join public.account_enforcement_state aes on aes.user_id = p.id
    where p.id = p_user_id;
end;
$function$;

revoke all on function public.admin_get_member(uuid) from public;
grant execute on function public.admin_get_member(uuid) to authenticated;


-- Reports where p_user_id is either side — one function, a `role`
-- column distinguishes direction, rather than two near-identical RPCs.
create or replace function public.admin_list_member_reports(p_user_id uuid)
returns table (
  id uuid,
  role text,
  target_type text,
  target_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  other_user_id uuid,
  other_pseudonym text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      r.id, 'as_target'::text, r.target_type, r.target_id, r.reason, r.status, r.created_at,
      r.reporter_user_id, rp.pseudonym
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    where r.reported_user_id = p_user_id

    union all

    select
      r.id, 'as_reporter'::text, r.target_type, r.target_id, r.reason, r.status, r.created_at,
      r.reported_user_id, tp.pseudonym
    from public.reports r
    join public.profiles tp on tp.id = r.reported_user_id
    where r.reporter_user_id = p_user_id

    order by created_at desc;
end;
$function$;

revoke all on function public.admin_list_member_reports(uuid) from public;
grant execute on function public.admin_list_member_reports(uuid) to authenticated;


create or replace function public.admin_list_audit_for_member(p_user_id uuid)
returns table (
  id uuid,
  actor_identifier_snapshot text,
  action text,
  reason text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      a.id, a.actor_identifier_snapshot, a.action, a.reason, a.metadata, a.created_at
    from public.admin_audit_log a
    where a.target_type = 'account_status'
      and a.target_id = p_user_id
    order by a.created_at desc
    limit 100;
end;
$function$;

revoke all on function public.admin_list_audit_for_member(uuid) from public;
grant execute on function public.admin_list_audit_for_member(uuid) to authenticated;


-- ============================================================
-- 7. STORAGE — staff may view ONLY an already-reported photo
-- ============================================================
-- Item 7's own requirement: "staff can inspect that reported evidence."
-- Deliberately NOT a general "staff can browse any private photo"
-- policy — that would be exactly the casual over-exposure the
-- checkpoint's privacy rule forbids. Each policy's EXISTS clause only
-- matches an object path that is the image_path of an ACTUAL
-- photo_moment report already on file; an unreported photo remains
-- exactly as invisible to staff as to anyone else. Additive to the
-- existing participant-scoped policies from docs/sql/2026-09-10-letter-
-- photos-select-role-scope-fix.sql and 2026-09-07-dispatches-and-
-- board.sql — those are completely untouched.
create policy letter_photos_admin_reported_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'letter-photos'
    and public.is_staff()
    and exists (
      select 1 from public.reports r
      where r.target_type = 'photo_moment'
        and r.evidence_snapshot->>'source' = 'letter'
        and r.evidence_snapshot->>'image_path' = storage.objects.name
    )
  );

create policy dispatch_photos_admin_reported_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dispatch-photos'
    and public.is_staff()
    and exists (
      select 1 from public.reports r
      where r.target_type = 'photo_moment'
        and r.evidence_snapshot->>'source' = 'dispatch'
        and r.evidence_snapshot->>'image_path' = storage.objects.name
    )
  );

commit;

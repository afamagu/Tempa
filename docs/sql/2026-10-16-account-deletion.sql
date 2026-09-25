-- ============================================================
-- TEMPA — MEMBER ACCOUNT DELETION (self-service closure)
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor
-- BEFORE deploying the application code that calls close_my_account().
-- Forward-only. Edits no historical migration. No Safety threshold,
-- ranking, publishing or classifier behaviour changes.
-- ============================================================
--
-- WHY NOT DELETE auth.users
-- Nearly every member table references auth.users ON DELETE CASCADE —
-- letters.sender_id AND recipient_id, correspondences, reports,
-- safety_cases/evaluations/signals/attempt_evidence,
-- account_enforcement_state, legal_acceptances, dispatches, … Hard-
-- deleting the auth user would silently destroy OTHER members' received
-- letters and every Safety / legal record (and let a ban be erased by
-- self-deletion). So a deleted member's auth user is RETAINED but
-- permanently disabled (banned at the Auth level by the server, see
-- app/you/account/actions.ts), and their member data is deleted or
-- de-identified here.
--
-- LIFECYCLE (close_my_account, one transaction, idempotent)
--   ACTIVE -> CLOSED: an account_closures row is written FIRST, in the
--   same transaction as the cleanup below; closure is never reversed
--   (no update/delete privilege, no RPC).
--   CLOSED is enforced through the existing single choke points:
--     * public.current_account_status() reports 'banned' for a closed
--       caller, so every existing write gate (41 RPCs checking
--       current_account_status() in ('restricted','suspended','banned'))
--       refuses them, and proxy.ts sends any stale session to
--       /account-unavailable;
--     * tempa_private.account_is_banned / hidden_from_discovery /
--       author_content_publicly_visible treat a closed member like a
--       banned one for EVERY other viewer: public_profiles, People
--       (discover_people), People to meet (get_member_introductions),
--       question_answers, Dispatch and reply visibility.
--
-- DELETED (the member's own data with no retained purpose)
--   profile row (and profile_marks rows, by cascade) — the live profile,
--   pseudonym, demographics, Mark; question_answers; Keep in Mind rows
--   (both directions); reading interests; guide completions; reading
--   places; Board views / Worth Reading marks; personal archive/hide/
--   acknowledgement preferences; member-introduction state and history
--   (both as viewer and as candidate); member Dispatches that are NOT
--   reported and have NO replies from other members (cascades their
--   topics/moments/shares/postcards/views).
--
-- DE-IDENTIFIED
--   member Dispatches that are reported or carry other members' replies
--   are UNPUBLISHED (hidden from everyone, share links dead) and kept;
--   the member's own Dispatch replies are tombstoned exactly like
--   delete_reply (deleted_at, empty body) so reply threads stay intact;
--   account_eligibility.date_of_birth is cleared (status kept);
--   letters they sent/received STAY in the other person's mailbox — the
--   sender renders as "A member" because the profile row is gone and no
--   profile is navigable; their active correspondences are closed.
--
-- RETAINED (Safety, abuse prevention, legal evidence)
--   reports (by and about them), safety_cases/evaluations/signals/
--   attempt_evidence, account_enforcement_state (bans/restrictions),
--   admin_audit_log, member_notices, blocked_users, legal_acceptances,
--   account_eligibility status, letters and letter photos (other
--   members' correspondence), arrival email delivery logs.
--
-- EMAIL: arrival emails are disabled and any pending arrival email to
-- them is marked skipped ('account_closed'); sent logs are kept.
--
-- STAFF: a member holding any staff role, or who created any Tempa or
-- Sponsored Dispatch, cannot self-delete — closure of such an account is
-- administrative, so official content (PR #17) is never hidden or
-- orphaned by self-service deletion.
--
-- STORAGE: close_my_account records the member-owned objects to remove
-- (their Mark images; Moment images of the Dispatches deleted above) in
-- account_closures.storage_objects BEFORE deleting the rows that name
-- them, so the server-side cleanup can be retried safely. Letter photos
-- (shared correspondence) and all official/catalogue assets are never
-- listed.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. CLOSURE STATE
-- ------------------------------------------------------------
create table if not exists public.account_closures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  closed_at timestamptz not null default now(),
  -- {"profile-marks": ["<mark id>.png", ...], "dispatch-photos": ["<uid>/<file>.jpg", ...]}
  storage_objects jsonb not null default '{}'::jsonb,
  storage_cleaned_at timestamptz,
  auth_disabled_at timestamptz,
  last_error text
);

-- Server-only bookkeeping: no member policy at all; the service role
-- (server action) and SECURITY DEFINER functions are the only readers.
alter table public.account_closures enable row level security;
revoke all on public.account_closures from public, anon, authenticated;

create or replace function tempa_private.account_is_closed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (select 1 from public.account_closures c where c.user_id = p_user_id)
$$;

revoke all on function tempa_private.account_is_closed(uuid) from public, anon;
grant execute on function tempa_private.account_is_closed(uuid) to authenticated;


-- ------------------------------------------------------------
-- 2. EXISTING CHOKE POINTS LEARN "CLOSED"
-- ------------------------------------------------------------
-- The caller's own status: a closed account is gated exactly like a ban.
create or replace function public.current_account_status()
returns text
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select case
    when exists (select 1 from public.account_closures c where c.user_id = auth.uid()) then 'banned'
    else coalesce(
      (select status from public.account_enforcement_state where user_id = auth.uid()),
      'active'
    )
  end
$$;

revoke all on function public.current_account_status() from public;
grant execute on function public.current_account_status() to authenticated;

-- Everyone else's view of a closed member = their view of a banned one.
create or replace function tempa_private.account_is_banned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (
    select 1 from public.account_enforcement_state s
    where s.user_id = p_user_id and s.status = 'banned'
  )
  or exists (select 1 from public.account_closures c where c.user_id = p_user_id)
$$;

create or replace function tempa_private.hidden_from_discovery(p_viewer uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select p_viewer is distinct from p_author
    and (
      exists (
        select 1 from public.account_enforcement_state s
        where s.user_id = p_author and s.status = 'banned'
      )
      or exists (select 1 from public.account_closures c where c.user_id = p_author)
      or (
        exists (
          select 1 from public.account_enforcement_state s
          where s.user_id = p_author and s.status in ('restricted', 'suspended')
        )
        and not exists (
          select 1 from public.letters l
          where (l.sender_id = p_viewer and l.recipient_id = p_author)
             or (l.sender_id = p_author and l.recipient_id = p_viewer)
        )
      )
    )
$$;

create or replace function tempa_private.author_content_publicly_visible(p_author_id uuid)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select coalesce(
    (select status from public.account_enforcement_state where user_id = p_author_id),
    'active'
  ) not in ('suspended', 'banned')
  and not exists (select 1 from public.account_closures c where c.user_id = p_author_id)
$$;


-- ------------------------------------------------------------
-- 3. CLOSE_MY_ACCOUNT — self only, idempotent
-- ------------------------------------------------------------
create or replace function public.close_my_account()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing public.account_closures;
  v_marks jsonb;
  v_photos jsonb;
  v_deletable uuid[];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  -- Retry: already closed -> nothing more to do in the database; hand
  -- back the recorded storage list so server-side cleanup can resume.
  select * into v_existing from public.account_closures where user_id = v_uid;
  if found then
    return jsonb_build_object(
      'closed_at', v_existing.closed_at,
      'already_closed', true,
      'storage_objects', v_existing.storage_objects
    );
  end if;

  if exists (select 1 from public.staff_roles sr where sr.user_id = v_uid) then
    raise exception 'Staff accounts are closed by Tempa administrators.';
  end if;

  if exists (select 1 from public.dispatches d where d.author_id = v_uid and d.published_as <> 'member') then
    raise exception 'This account created official Tempa content and is closed by Tempa administrators.';
  end if;

  -- Serialise with admin status changes / automatic restriction, which
  -- lock the same profiles row.
  perform 1 from public.profiles p where p.id = v_uid for update;

  -- Member Dispatches that can be physically deleted: not reported (as a
  -- Dispatch or through one of its photo Moments) and no reply from any
  -- other member. Everything else is unpublished and retained.
  select coalesce(array_agg(d.id), '{}')
  into v_deletable
  from public.dispatches d
  where d.author_id = v_uid
    and d.published_as = 'member'
    and not exists (
      select 1 from public.reports r
      where (r.target_type = 'dispatch' and r.target_id = d.id)
         or (r.target_type = 'photo_moment' and r.target_id in (
              select dm.id from public.dispatch_moments dm where dm.dispatch_id = d.id))
    )
    and not exists (
      select 1 from public.dispatch_replies dr
      where dr.dispatch_id = d.id and dr.author_id <> v_uid
    );

  select coalesce(jsonb_agg(pm.id::text || '.png' order by pm.created_at), '[]'::jsonb)
  into v_marks
  from public.profile_marks pm
  where pm.owner_id = v_uid;

  select coalesce(jsonb_agg(dm.image_path order by dm.image_path), '[]'::jsonb)
  into v_photos
  from public.dispatch_moments dm
  where dm.dispatch_id = any (v_deletable)
    and (storage.foldername(dm.image_path))[1] = v_uid::text;

  -- ACTIVE -> CLOSED first (same transaction as everything below).
  insert into public.account_closures (user_id, storage_objects)
  values (v_uid, jsonb_build_object('profile-marks', v_marks, 'dispatch-photos', v_photos));

  -- Public writing
  delete from public.dispatches where id = any (v_deletable);

  update public.dispatch_shares ds
  set revoked_at = coalesce(ds.revoked_at, now())
  from public.dispatches d
  where ds.dispatch_id = d.id and d.author_id = v_uid and d.published_as = 'member';

  update public.dispatches
  set status = 'unpublished'
  where author_id = v_uid and published_as = 'member' and status <> 'unpublished';

  update public.dispatch_replies
  set deleted_at = now(), body = ''
  where author_id = v_uid and deleted_at is null;

  delete from public.question_answers where user_id = v_uid;

  -- Relationships / personal preferences
  delete from public.kept_minds where viewer_user_id = v_uid or kept_user_id = v_uid;
  delete from public.profile_interests where viewer_user_id = v_uid;
  delete from public.guide_completions where user_id = v_uid;
  delete from public.reading_places where user_id = v_uid;
  delete from public.dispatch_views where viewer_id = v_uid;
  delete from public.dispatch_worth_reading where user_id = v_uid;
  delete from public.correspondence_hidden_for_user where user_id = v_uid;
  delete from public.letter_archive_removals where user_id = v_uid;
  delete from public.postcard_keepsake_removals where user_id = v_uid;
  delete from public.correspondence_feature_acknowledgements where user_id = v_uid;
  delete from public.member_introduction_history where viewer_id = v_uid or candidate_id = v_uid;
  delete from public.member_introduction_state where viewer_id = v_uid;

  -- Correspondence: the other person keeps their letters; the thread closes.
  update public.correspondences
  set status = 'closed', closed_at = now()
  where status = 'active' and (participant_low = v_uid or participant_high = v_uid);

  -- Email: no further product email; delivery logs kept.
  insert into public.arrival_email_preferences (user_id, arrival_emails_enabled, updated_at)
  values (v_uid, false, now())
  on conflict (user_id) do update set arrival_emails_enabled = false, updated_at = now();

  update public.arrival_email_queue
  set status = 'skipped', skipped_reason = 'account_closed', updated_at = now()
  where recipient_id = v_uid and status = 'pending';

  -- Eligibility: keep the outcome, drop the birth date.
  update public.account_eligibility set date_of_birth = null, updated_at = now() where user_id = v_uid;

  -- The live profile (profile_marks rows cascade).
  delete from public.profiles where id = v_uid;

  return jsonb_build_object(
    'closed_at', now(),
    'already_closed', false,
    'storage_objects', jsonb_build_object('profile-marks', v_marks, 'dispatch-photos', v_photos)
  );
end;
$function$;

revoke all on function public.close_my_account() from public, anon;
grant execute on function public.close_my_account() to authenticated;

commit;

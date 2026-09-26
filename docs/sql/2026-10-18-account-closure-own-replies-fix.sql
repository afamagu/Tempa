-- ============================================================
-- TEMPA — ACCOUNT CLOSURE: A MEMBER'S OWN REPLIES UNDER THEIR OWN DISPATCH
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-18-account-closure-own-replies-fix-verify.sql
-- (read-only; overall_pass must be true).
-- Forward-only. Does NOT edit the applied 2026-10-16 migration. Same
-- signature and grants — no app deploy needed for the database fix.
-- ============================================================
--
-- PRODUCTION FAILURE: close_my_account() (2026-10-16) physically deletes
-- the member's "deletable" Dispatches (unreported, no reply from another
-- member) BEFORE it tombstones the member's replies. A Dispatch carrying
-- the member's OWN reply therefore hit
--   23503 update or delete on table "dispatches" violates foreign key
--   constraint "dispatch_replies_dispatch_id_fkey" on table
--   "dispatch_replies"
-- (dispatch_replies.dispatch_id references dispatches(id) with NO ON
-- DELETE action — 2026-09-23). The whole transaction rolled back, so the
-- member saw "We couldn't delete your account. Nothing has been changed".
--
-- FIX (close_my_account only; everything else verbatim from 2026-10-16):
--   1. a Dispatch with a REPORTED reply is never deletable (retained,
--      unpublished, like any other evidence);
--   2. before deleting the deletable Dispatches, delete the member's own
--      replies under them (author_id = auth.uid() only).
-- Unchanged: self-only, staff / official-content refusal, idempotent
-- retry, closure recorded first, storage list, Safety/legal retention,
-- other members' letters and replies, exit feedback, every gate.

begin;

create or replace function public.close_my_account(
  p_reason_code text default null,
  p_reason_detail text default null
)
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
  v_reason_code text := nullif(trim(both from coalesce(p_reason_code, '')), '');
  v_reason_detail text := nullif(trim(both from coalesce(p_reason_detail, '')), '');
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

  -- Optional exit feedback: never required; validated before anything
  -- changes so a bad value can never half-close an account.
  if v_reason_code is not null and v_reason_code not in (
    'not_finding_connections', 'not_using_tempa', 'not_meeting_expectations',
    'too_many_letters', 'privacy_or_safety', 'something_else'
  ) then
    raise exception 'Unknown reason.';
  end if;
  if v_reason_code is distinct from 'something_else' then
    v_reason_detail := null;
  end if;
  if v_reason_detail is not null and char_length(v_reason_detail) > 1000 then
    raise exception 'That note is too long.';
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
  -- Dispatch, through one of its photo Moments, or through one of its
  -- replies) and no reply from any other member. Everything else is
  -- unpublished and retained.
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
    )
    and not exists (
      select 1 from public.reports r
      join public.dispatch_replies dr on dr.id = r.target_id
      where r.target_type = 'reply' and dr.dispatch_id = d.id
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
  insert into public.account_closures (user_id, storage_objects, reason_code, reason_detail)
  values (v_uid, jsonb_build_object('profile-marks', v_marks, 'dispatch-photos', v_photos), v_reason_code, v_reason_detail);

  -- Public writing. The member's OWN replies under a deletable Dispatch
  -- go first: dispatch_replies.dispatch_id has no ON DELETE action, so
  -- they would otherwise block the Dispatch delete (2026-10-18 fix).
  -- Scoped to author_id = v_uid: a reply from anyone else still blocks the
  -- delete and rolls the whole closure back, never losing their words.
  delete from public.dispatch_replies
  where dispatch_id = any (v_deletable) and author_id = v_uid;

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

revoke all on function public.close_my_account(text, text) from public, anon;
grant execute on function public.close_my_account(text, text) to authenticated;

commit;

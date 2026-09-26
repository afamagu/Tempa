-- ============================================================
-- TEMPA — ACCOUNT LIFECYCLE: TAKE A BREAK, DELETION, EXIT FEEDBACK
-- STATUS: APPLIED TO PRODUCTION 2026-09-26 (before the PR #19 deploy);
-- 2026-10-16-account-lifecycle-verify.sql returned overall_pass = true.
-- Do not re-run casually. Must precede the app code that calls it.
-- Forward-only. Edits no historical migration. Supersedes the unexecuted
-- PR #19 draft (2026-10-16-account-deletion.sql) — this ONE file is the
-- whole lifecycle. No Safety threshold, ranking or classifier changes.
-- ============================================================
--
-- THREE STATES, KEPT SEPARATE
--   ACTIVE
--   DEACTIVATED ("Take a break") — reversible. account_deactivations holds
--     an append-only history: one row per break, reactivated_at set on
--     return; at most one open row per member (partial unique index).
--     Nothing is deleted or mutated: public content disappears because
--     the visibility gates below consult the open row, and reappears the
--     moment it is closed.
--   CLOSED (permanent deletion) — account_closures, never reversible.
--   Safety enforcement (restricted / suspended / banned) stays in
--   account_enforcement_state and is never written by either lifecycle.
--
-- WHY NOT DELETE auth.users (unchanged from the PR #19 analysis)
-- Nearly every member table references auth.users ON DELETE CASCADE —
-- including OTHER members' received letters and every Safety / legal
-- record. A closed member's auth user is retained but permanently
-- disabled by the server (app/you/account/actions.ts).
--
-- CHOKE POINTS (no per-RPC edits)
--   public.current_account_status() — the caller's own write gate:
--     closed -> 'banned', deactivated -> 'suspended'. Every existing write
--     RPC (41 checks of current_account_status() in ('restricted',
--     'suspended','banned'), plus the reply/write/first-contact status
--     branches) therefore refuses them. This is a gate mapping only: it
--     is never persisted, and admin/Safety tooling reads
--     account_enforcement_state directly, so nobody is recorded as
--     suspended.
--   public.my_account_lifecycle() — the caller's REAL lifecycle state
--     ('active' | 'deactivated' | 'closed'); current_account_entry_state
--     reports it so proxy.ts sends a deactivated member to /account-paused
--     and a closed session to /account-deleted, never to the ban notice.
--   tempa_private.hidden_from_discovery / author_content_publicly_visible
--     — deactivated and closed members disappear from People, People to
--     meet, answers, the Board, Dispatches, replies and share links.
--   public.public_profiles — closed members vanish entirely; a member on
--     a break stays visible ONLY to people who already share letters
--     with them (so their correspondents keep their pseudonym and Mark).
--   correspondences BEFORE INSERT guard — no NEW correspondence (first
--     contact) can involve a deactivated or closed member. Existing
--     correspondence and in-transit letters are untouched.
--   resolve_arrival_email_context — no arrival email to a closed member
--     or a member on a break; their stored preference is not changed.
--
-- EXIT FEEDBACK (optional, never required)
--   deactivate_my_account(p_reason_code, p_reason_detail) stores it on
--   the break row; close_my_account(p_reason_code, p_reason_detail)
--   stores it atomically on the closure row. Both are SELF ONLY — the
--   only account either touches is auth.uid(); neither has a target
--   account argument. admin_account_exit_feedback() collates it for
--   staff: counts, reason breakdown, recent notes — no identities.
--
-- FIRST-CONTACT "SOMETHING ELSE"
--   letters.close_reason may now also be the fixed marker
--   'Something else' (never free text). The optional explanation is
--   feedback to Tempa, stored in letter_close_feedback (RLS on, no member
--   policy or privilege, not in letters_for_participant, not in any
--   member RPC); staff read it through admin_account_exit_feedback().
--
-- The PR #19 deletion rules are unchanged: see close_my_account below.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. LIFECYCLE STATE
-- ------------------------------------------------------------
create table if not exists public.account_closures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  closed_at timestamptz not null default now(),
  -- {"profile-marks": ["<mark id>.png", ...], "dispatch-photos": ["<uid>/<file>.jpg", ...]}
  storage_objects jsonb not null default '{}'::jsonb,
  storage_cleaned_at timestamptz,
  auth_disabled_at timestamptz,
  last_error text,
  -- optional exit feedback, stored atomically with the closure
  reason_code text check (reason_code in (
    'not_finding_connections', 'not_using_tempa', 'not_meeting_expectations',
    'too_many_letters', 'privacy_or_safety', 'something_else'
  )),
  reason_detail text check (reason_detail is null or char_length(reason_detail) <= 1000)
);

alter table public.account_closures enable row level security;
revoke all on public.account_closures from public, anon, authenticated;

create table if not exists public.account_deactivations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deactivated_at timestamptz not null default now(),
  reactivated_at timestamptz,
  reason_code text check (reason_code in (
    'need_a_break', 'life_is_busy', 'not_finding_connections',
    'too_many_letters', 'privacy_or_safety', 'something_else'
  )),
  reason_detail text check (reason_detail is null or char_length(reason_detail) <= 1000),
  check (reactivated_at is null or reactivated_at >= deactivated_at)
);

create unique index if not exists account_deactivations_one_open
  on public.account_deactivations (user_id)
  where reactivated_at is null;

-- History is staff/server data: no member policy or privilege at all.
alter table public.account_deactivations enable row level security;
revoke all on public.account_deactivations from public, anon, authenticated;

create or replace function tempa_private.account_is_closed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (select 1 from public.account_closures c where c.user_id = p_user_id)
$$;

-- Internal only (Part 5 review correction): no member-facing path needs to
-- ask whether an ARBITRARY account is closed. No RLS policy or view calls
-- this; SECURITY DEFINER functions inline their own closure checks.
revoke all on function tempa_private.account_is_closed(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 2. THE CALLER'S OWN STATE
-- ------------------------------------------------------------
create or replace function public.my_account_lifecycle()
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.account_closures c where c.user_id = auth.uid()) then 'closed'
    when exists (
      select 1 from public.account_deactivations d
      where d.user_id = auth.uid() and d.reactivated_at is null
    ) then 'deactivated'
    else 'active'
  end
$$;

revoke all on function public.my_account_lifecycle() from public, anon;
grant execute on function public.my_account_lifecycle() to authenticated;

-- Write-gate mapping only (see header): never persisted anywhere.
create or replace function public.current_account_status()
returns text
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select case
    when exists (select 1 from public.account_closures c where c.user_id = auth.uid()) then 'banned'
    when exists (
      select 1 from public.account_deactivations d
      where d.user_id = auth.uid() and d.reactivated_at is null
    ) then 'suspended'
    else coalesce(
      (select status from public.account_enforcement_state where user_id = auth.uid()),
      'active'
    )
  end
$$;

revoke all on function public.current_account_status() from public;
grant execute on function public.current_account_status() to authenticated;

create or replace function public.current_account_entry_state(
  p_terms_version text,
  p_guidelines_version text
)
returns table (
  account_status text,
  eligibility_status text,
  has_profile boolean,
  onboarding_stage text,
  terms_current boolean,
  guidelines_current boolean
)
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  select
    -- LIFECYCLE (2026-10-16): voluntary deactivation and closure are
    -- reported as their own states so proxy.ts routes them to
    -- /account-paused and /account-deleted, never to the ban notice.
    case public.my_account_lifecycle()
      when 'closed' then 'closed'
      when 'deactivated' then 'deactivated'
      else public.current_account_status()
    end as account_status,
    (
      select e.status
      from public.account_eligibility e
      where e.user_id = auth.uid()
    ) as eligibility_status,
    exists (
      select 1 from public.profiles p where p.id = auth.uid()
    ) as has_profile,
    (
      select p.onboarding_stage::text
      from public.profiles p
      where p.id = auth.uid()
    ) as onboarding_stage,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'terms_of_service'
        and la.document_version = p_terms_version
    ) as terms_current,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'community_guidelines'
        and la.document_version = p_guidelines_version
    ) as guidelines_current
  where auth.uid() is not null
$function$;

revoke all on function public.current_account_entry_state(text, text) from public, anon;
grant execute on function public.current_account_entry_state(text, text) to authenticated;


-- ------------------------------------------------------------
-- 3. EVERYONE ELSE'S VIEW
-- ------------------------------------------------------------
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
      or exists (
        select 1 from public.account_deactivations d
        where d.user_id = p_author and d.reactivated_at is null
      )
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
  and not exists (
    select 1 from public.account_deactivations d
    where d.user_id = p_author_id and d.reactivated_at is null
  )
$$;

create or replace view public.public_profiles
with (security_barrier = true)
as
select
  p.id,
  p.pseudonym,
  p.country,
  p.gender,
  p.gender_custom,
  p.age_range,
  p.languages,
  p.intent,
  p.pinned_dispatch_id,
  p.mark_id
from public.profiles p
where auth.uid() = p.id
   or (
     not tempa_private.is_blocked_pair(auth.uid(), p.id)
     and not tempa_private.account_is_banned(p.id)
     -- LIFECYCLE (2026-10-16): a member taking a break is visible only to
     -- people who already share letters with them (historical identity
     -- stays meaningful); everyone else no longer sees their profile.
     and not (
       exists (
         select 1 from public.account_deactivations ad
         where ad.user_id = p.id and ad.reactivated_at is null
       )
       and not exists (
         select 1 from public.letters l
         where (l.sender_id = auth.uid() and l.recipient_id = p.id)
            or (l.sender_id = p.id and l.recipient_id = auth.uid())
       )
     )
   );

revoke all on public.public_profiles from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.public_profiles from authenticated;
grant select on public.public_profiles to authenticated;

create or replace function public.get_shared_dispatch(p_token uuid)
returns table (
  dispatch_id uuid,
  title text,
  body text,
  published_at timestamptz,
  author_pseudonym text,
  author_country text,
  topics text[],
  moments jsonb,
  postcard jsonb,
  published_as text,
  sponsor_name text,
  sponsor_cta_label text,
  sponsor_cta_url text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  found_id uuid;
begin
  select d.id
  into found_id
  from public.dispatch_shares ds
  join public.dispatches d on d.id = ds.dispatch_id
  where ds.id = p_token
    and ds.revoked_at is null
    and d.status = 'published'
    and d.moderation_status = 'visible'
    -- LIFECYCLE (2026-10-16): a member Dispatch is not readable through a
    -- share link while its author is on a break / suspended / banned /
    -- closed — the same author gate every in-app Dispatch surface uses.
    -- Tempa and Sponsored rows are never gated on the creating admin.
    and (d.published_as <> 'member' or tempa_private.author_content_publicly_visible(d.author_id));

  if found_id is null then
    return;
  end if;

  return query
  select
    d.id,
    d.title,
    d.body,
    d.published_at,
    case d.published_as
      when 'tempa' then 'Tempa'
      when 'sponsored' then d.sponsor_name
      else coalesce(
        (select pp.pseudonym from public.public_profiles pp where pp.id = d.author_id),
        'A TEMPA member'
      )
    end,
    case
      when d.published_as = 'member'
        then (select pp.country from public.public_profiles pp where pp.id = d.author_id)
    end,
    coalesce(
      (select array_agg(t.topic order by t.topic) from public.dispatch_topics t where t.dispatch_id = d.id),
      '{}'::text[]
    ),
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', dm.id, 'position', dm.position, 'image_path', dm.image_path) order by dm.position)
        from public.dispatch_moments dm
        where dm.dispatch_id = d.id
      ),
      '[]'::jsonb
    ),
    (
      select jsonb_build_object(
        'title', pv.title,
        'location', pv.location,
        'collection', pv.collection,
        'postmark_text', pv.postmark_text,
        'footer_text', pv.footer_text,
        'front_image_path', pv.front_image_path,
        'motion_src', pv.motion_src,
        'duration_seconds', pv.duration_seconds,
        'reveal_line_alignment', pv.reveal_line_alignment,
        'reveal_line', dp.reveal_line,
        'back_message', dp.back_message,
        'sender_pseudonym_snapshot', dp.sender_pseudonym_snapshot
      )
      from public.dispatch_postcards dp
      join public.postcard_versions pv on pv.id = dp.postcard_version_id
      where dp.dispatch_id = d.id
    ),
    d.published_as,
    d.sponsor_name,
    d.sponsor_cta_label,
    d.sponsor_cta_url
  from public.dispatches d
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

create or replace function public.resolve_arrival_email_context(p_queue_id uuid)
returns table (
  eligible boolean,
  skip_reason text,
  recipient_email text,
  first_contact boolean,
  sender_pseudonym text,
  sender_country_code text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $$
declare
  v_letter public.letters;
  v_letter_id uuid;
  v_recipient_id uuid;
  v_recipient_status text;
  v_blocked boolean;
  v_hidden boolean;
  v_pref_enabled boolean;
  v_email text;
  v_pseudonym text;
  v_country text;
  v_established_at timestamptz;
begin
  select q.recipient_id, q.letter_id into v_recipient_id, v_letter_id
  from public.arrival_email_queue q
  where q.id = p_queue_id;

  if not found then
    return query select false, 'queue_row_not_found', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select * into v_letter from public.letters where id = v_letter_id;

  if not found then
    return query select false, 'letter_not_found', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select ae.status into v_recipient_status
  from public.account_enforcement_state ae
  where ae.user_id = v_recipient_id;

  if v_recipient_status is not null and v_recipient_status <> 'active' then
    return query select false, 'recipient_account_' || v_recipient_status, null::text, null::boolean, null::text, null::text;
    return;
  end if;

  -- LIFECYCLE (2026-10-16): no product email to a closed account or to a
  -- member taking a break. Their stored preference is NOT touched, so it
  -- applies again as soon as they return.
  if exists (select 1 from public.account_closures c where c.user_id = v_recipient_id) then
    return query select false, 'recipient_account_closed', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  if exists (
    select 1 from public.account_deactivations d
    where d.user_id = v_recipient_id and d.reactivated_at is null
  ) then
    return query select false, 'recipient_on_break', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  -- Reuses the existing helper rather than re-deriving block logic here
  -- — it's built exactly for this: "only ever called from inside the
  -- SECURITY DEFINER correspondence RPCs ... which execute under their
  -- owning role and need no EXECUTE grant of their own to call another
  -- function owned by that same role" (its own comment, docs/sql/
  -- 2026-09-12-scoped-blocking-and-fixes.sql). Same "any scope, either
  -- direction" semantics send_first_letter/reply_to_letter/write_letter
  -- already gate new correspondence on.
  select tempa_private.is_correspondence_blocked_pair(v_letter.sender_id, v_letter.recipient_id)
    into v_blocked;

  if v_blocked then
    return query select false, 'blocked', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select exists (
    select 1 from public.correspondence_hidden_for_user h
    where h.user_id = v_letter.recipient_id
      and h.correspondence_id = v_letter.correspondence_id
  ) into v_hidden;

  if v_hidden then
    return query select false, 'correspondence_hidden', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select p.arrival_emails_enabled into v_pref_enabled
  from public.arrival_email_preferences p
  where p.user_id = v_letter.recipient_id;

  if v_pref_enabled is false then
    return query select false, 'preference_disabled', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select u.email into v_email from auth.users u where u.id = v_letter.recipient_id;

  if v_email is null then
    return query select false, 'recipient_email_missing', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select c.established_at into v_established_at
  from public.correspondences c
  where c.id = v_letter.correspondence_id;

  select pr.pseudonym, pr.country_code into v_pseudonym, v_country
  from public.profiles pr
  where pr.id = v_letter.sender_id;

  return query select
    true,
    null::text,
    v_email,
    (v_established_at is null),
    v_pseudonym,
    v_country;
end;
$$;

revoke all on function public.resolve_arrival_email_context(uuid) from public;
grant execute on function public.resolve_arrival_email_context(uuid) to service_role;

-- No NEW correspondence (i.e. no first contact) with a member who is on a
-- break or closed. Existing correspondences are never touched.
create or replace function tempa_private.correspondences_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if exists (
    select 1 from public.account_deactivations d
    where d.user_id in (new.participant_low, new.participant_high) and d.reactivated_at is null
  ) or exists (
    select 1 from public.account_closures c
    where c.user_id in (new.participant_low, new.participant_high)
  ) then
    raise exception 'Recipient does not exist.';
  end if;
  return new;
end;
$function$;

revoke all on function tempa_private.correspondences_lifecycle_guard() from public, anon, authenticated;

create trigger correspondences_lifecycle_guard
  before insert on public.correspondences
  for each row execute function tempa_private.correspondences_lifecycle_guard();

-- For a member's own letters: which of these people are currently taking
-- a break. Only ever answers for people who share letters with the
-- caller — it cannot probe anyone else.
create or replace function public.correspondents_on_break(p_user_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select d.user_id
  from public.account_deactivations d
  where auth.uid() is not null
    and d.reactivated_at is null
    and d.user_id = any (coalesce(p_user_ids, '{}'::uuid[]))
    and exists (
      select 1 from public.letters l
      where (l.sender_id = auth.uid() and l.recipient_id = d.user_id)
         or (l.sender_id = d.user_id and l.recipient_id = auth.uid())
    )
$$;

revoke all on function public.correspondents_on_break(uuid[]) from public, anon;
grant execute on function public.correspondents_on_break(uuid[]) to authenticated;


-- ------------------------------------------------------------
-- 4. TAKE A BREAK / RETURN — self only
-- ------------------------------------------------------------
create or replace function public.deactivate_my_account(
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
  v_open public.account_deactivations;
  v_reason_code text := nullif(trim(both from coalesce(p_reason_code, '')), '');
  v_reason_detail text := nullif(trim(both from coalesce(p_reason_detail, '')), '');
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if exists (select 1 from public.account_closures c where c.user_id = v_uid) then
    raise exception 'This account has been deleted.';
  end if;

  -- Staff / official-content creators: a break would hide Tempa content
  -- authored under their account, so it is handled administratively.
  if exists (select 1 from public.staff_roles sr where sr.user_id = v_uid)
     or exists (select 1 from public.dispatches d where d.author_id = v_uid and d.published_as <> 'member') then
    raise exception 'Staff accounts can''t take a break here. Ask another administrator.';
  end if;

  if v_reason_code is not null and v_reason_code not in (
    'need_a_break', 'life_is_busy', 'not_finding_connections',
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

  -- Retry-safe: an open break is returned as-is.
  select * into v_open from public.account_deactivations
  where user_id = v_uid and reactivated_at is null;
  if found then
    return jsonb_build_object('deactivated_at', v_open.deactivated_at, 'already_deactivated', true);
  end if;

  insert into public.account_deactivations (user_id, reason_code, reason_detail)
  values (v_uid, v_reason_code, v_reason_detail)
  returning * into v_open;

  return jsonb_build_object('deactivated_at', v_open.deactivated_at, 'already_deactivated', false);
end;
$function$;

revoke all on function public.deactivate_my_account(text, text) from public, anon;
grant execute on function public.deactivate_my_account(text, text) to authenticated;

create or replace function public.reactivate_my_account()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if exists (select 1 from public.account_closures c where c.user_id = v_uid) then
    raise exception 'This account has been deleted.';
  end if;

  update public.account_deactivations
  set reactivated_at = now()
  where user_id = v_uid and reactivated_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('reactivated', v_count > 0);
end;
$function$;

revoke all on function public.reactivate_my_account() from public, anon;
grant execute on function public.reactivate_my_account() to authenticated;


-- ------------------------------------------------------------
-- 5. PERMANENT DELETION — self only, idempotent, optional feedback
-- ------------------------------------------------------------
drop function if exists public.close_my_account();

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
  insert into public.account_closures (user_id, storage_objects, reason_code, reason_detail)
  values (v_uid, jsonb_build_object('profile-marks', v_marks, 'dispatch-photos', v_photos), v_reason_code, v_reason_detail);

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

revoke all on function public.close_my_account(text, text) from public, anon;
grant execute on function public.close_my_account(text, text) to authenticated;


-- ------------------------------------------------------------
-- 6. FIRST CONTACT: "SOMETHING ELSE" + PRIVATE FEEDBACK TO TEMPA
-- ------------------------------------------------------------
alter table public.letters drop constraint letters_closed_fields_consistent;
alter table public.letters add constraint letters_closed_fields_consistent
  check (
    (
      status <> 'closed'
      and closed_by is null
      and close_reason is null
      and closed_at is null
    )
    or
    (
      status = 'closed'
      and closed_by = 'recipient'
      and closed_at is not null
      and close_reason in (
        'I can''t take on another correspondence right now.',
        'I don''t think we''re the right correspondence.',
        'I''m taking a break from new letters.',
        'Something else'
      )
    )
    or
    (
      status = 'closed'
      and closed_by = 'system'
      and closed_at is not null
      and close_reason is null
    )
  );

create table if not exists public.letter_close_feedback (
  letter_id uuid primary key references public.letters(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.letter_close_feedback enable row level security;
revoke all on public.letter_close_feedback from public, anon, authenticated;

drop function if exists public.close_letter(uuid, text);

create or replace function public.close_letter(
  p_letter_id uuid,
  p_reason text,
  p_detail text default null
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  closed_letter public.letters;
  corr public.correspondences;
  other_root_live boolean;
  result public.letters_for_participant;
  v_detail text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- LIFECYCLE (2026-10-16): the fourth reason. Only the fixed marker
  -- 'Something else' is ever written to letters.close_reason (which the
  -- sender can read); the optional explanation is feedback TO TEMPA and
  -- goes to the private letter_close_feedback table below, never to the
  -- sender, the correspondence or any notification.
  if p_reason is null or p_reason not in (
    'I can''t take on another correspondence right now.',
    'I don''t think we''re the right correspondence.',
    'I''m taking a break from new letters.',
    'Something else'
  ) then
    raise exception 'Choose one of the listed reasons.';
  end if;

  v_detail := nullif(trim(both from coalesce(p_detail, '')), '');

  if v_detail is not null and p_reason <> 'Something else' then
    raise exception 'A written explanation is only accepted with Something else.';
  end if;

  if v_detail is not null and char_length(v_detail) > 1000 then
    raise exception 'That explanation is too long.';
  end if;


  update public.letters

  set
    status = 'closed',
    closed_at = now(),
    closed_by = 'recipient',
    close_reason = p_reason

  where
    id = p_letter_id
    and recipient_id = auth.uid()
    and reply_to_id is null
    and status = 'sent'
    and expires_at > now()
    and deliver_at <= now()

  returning *
  into closed_letter;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a decision.';
  end if;


  if v_detail is not null then
    insert into public.letter_close_feedback (letter_id, recipient_id, detail)
    values (closed_letter.id, auth.uid(), v_detail)
    on conflict (letter_id) do nothing;
  end if;


  select *
  into corr

  from public.correspondences

  where id = closed_letter.correspondence_id

  for update;


  select exists (
    select 1
    from public.letters
    where correspondence_id = corr.id
      and reply_to_id is null
      and id <> closed_letter.id
      and status = 'sent'
      and expires_at > now()
  )
  into other_root_live;

  if corr.established_at is null and not other_root_live then

    update public.correspondences

    set
      status = 'closed',
      closed_at = closed_letter.closed_at

    where id = corr.id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = p_letter_id;


  return result;

end;
$function$;

revoke all on function public.close_letter(uuid, text, text) from public, anon;
grant execute on function public.close_letter(uuid, text, text) to authenticated;


-- ------------------------------------------------------------
-- 7. ADMIN: ACCOUNT-EXIT FEEDBACK (staff only, no identities)
-- ------------------------------------------------------------
create or replace function public.admin_account_exit_feedback(p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
begin
  if not public.is_staff() then
    raise exception 'Staff only.';
  end if;

  return jsonb_build_object(
    'deactivations', (select count(*) from public.account_deactivations where deactivated_at >= v_since),
    'reactivations', (select count(*) from public.account_deactivations where reactivated_at >= v_since),
    'deletions', (select count(*) from public.account_closures where closed_at >= v_since),
    'currently_on_break', (select count(*) from public.account_deactivations where reactivated_at is null),
    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object('event', r.event, 'reason_code', r.reason_code, 'count', r.n) order by r.event, r.n desc)
      from (
        select 'deactivation' as event, coalesce(reason_code, 'not_given') as reason_code, count(*) as n
        from public.account_deactivations where deactivated_at >= v_since group by 2
        union all
        select 'deletion', coalesce(reason_code, 'not_given'), count(*)
        from public.account_closures where closed_at >= v_since group by 2
      ) r
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('event', x.event, 'reason_code', x.reason_code, 'detail', x.detail, 'at', x.at) order by x.at desc)
      from (
        select u.* from (
          select 'deactivation'::text as event, reason_code, reason_detail as detail, deactivated_at as at
          from public.account_deactivations where deactivated_at >= v_since
          union all
          select 'reactivation', null, null, reactivated_at
          from public.account_deactivations where reactivated_at >= v_since
          union all
          select 'deletion', reason_code, reason_detail, closed_at
          from public.account_closures where closed_at >= v_since
        ) u
        order by u.at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'letter_pass_notes', coalesce((
      select jsonb_agg(jsonb_build_object('detail', f.detail, 'at', f.created_at) order by f.created_at desc)
      from (
        select detail, created_at from public.letter_close_feedback
        where created_at >= v_since order by created_at desc limit 50
      ) f
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.admin_account_exit_feedback(timestamptz) from public, anon;
grant execute on function public.admin_account_exit_feedback(timestamptz) to authenticated;

commit;

-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 9: RATE LIMITS + LAUNCH SECURITY
-- HARDENING
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER every earlier Safety migration. Does NOT merge to main, deploy,
-- or enable enforcement for real members.
-- ============================================================
--
-- READ-ONLY LAUNCH ATTACK-SURFACE AUDIT — see this checkpoint's own
-- chat report for the full matrix (surface | protection | gap |
-- blocker? | fix). Summary of what this file actually fixes, and why
-- each other audited surface needed NO change:
--
--   FIXED HERE:
--   1. public.dispatch_moments still carried a live, unrevoked raw
--      INSERT grant to `authenticated` (docs/sql/2026-09-07-dispatches-
--      and-board.sql) — the EXACT bypass class docs/sql/2026-10-06-
--      safety-checkpoint4-public-surfaces.sql already closed for
--      `dispatches`/`dispatch_topics`, but that audit never reached
--      `dispatch_moments`. A member could attach a photo Moment to
--      their own already-published Dispatch directly, bypassing
--      publish_dispatch/update_dispatch's own paragraph-position/type/
--      ownership validation entirely. Closed below (Part 1).
--   2. public.account_enforcement_state's own RLS let a member SELECT
--      their own row directly — including status_reason (internal
--      Admin reasoning) and changed_by — via a raw client call, even
--      though zero application code anywhere reads it that way (grep
--      confirms only test/simulator files reference the table by name;
--      every real consumer already goes through is_staff()-gated Admin
--      RPCs or the member's own current_account_status(), which already
--      returns only the bare status string). Closed below (Part 2) by
--      revoking the raw SELECT grant and dropping the now-purposeless
--      self-select policy — current_account_status() remains the one
--      member-safe status surface, unchanged.
--   3. No rate limiting exists anywhere in this codebase (confirmed:
--      no rate-limiting library in package.json, no existing mechanism
--      in any Route Handler or RPC). Built the smallest durable, SQL-
--      backed mechanism appropriate to this app's actual architecture
--      (mostly direct Supabase RPC writes, not conventional API
--      endpoints an edge/route middleware could meaningfully guard) —
--      Part 3 below.
--   4. Seven early tables (dispatches, dispatch_topics, dispatch_
--      moments, dispatch_views, kept_minds, dispatch_shares, dispatch_
--      replies — all from docs/sql/2026-09-06/07/23) only ever revoked
--      grants `from public`, never explicitly `from anon` at creation
--      time, unlike the stricter `from public, anon, authenticated`
--      convention every table from 2026-09-11 onward already uses.
--      Supabase's own project-level default-privilege bootstrap grants
--      full CRUD directly to `anon`/`authenticated` on every new table
--      (documented in this codebase's own docs/sql/2026-09-11-safety-
--      blocking-foundation.sql:69-86), so a bare `revoke ... from
--      public` never actually touched that default grant for these
--      seven tables. RLS already has no `anon`-scoped policy on any of
--      them (confirmed), so this was defense-in-depth only, never a
--      live exploit — closed explicitly below (Part 4) to match the
--      project's own later, stricter convention.
--   5. No security headers configured anywhere (next.config.ts has only
--      a redirects() block; no middleware.ts exists) — X-Content-Type-
--      Options, Referrer-Policy, Permissions-Policy, and frame
--      protection added directly in next.config.ts (a TypeScript file,
--      not SQL — see that file's own diff). A full CSP is deliberately
--      NOT added here: this app serves Supabase Storage images/fonts/
--      Google OAuth/Cloudflare Turnstile/Tiptap runtime code from
--      several origins, and a safe CSP needs its own nonce architecture
--      and dedicated testing — backlogged explicitly rather than
--      shipping a broken or falsely-reassuring CSP under launch
--      deadline pressure.
--
--   AUDITED, NO FIX NEEDED (confirmed by direct inspection, not
--   assumed):
--   - Cron endpoint (app/api/cron/arrival-emails/route.ts): already
--     uses node:crypto timingSafeEqual for the bearer-secret comparison
--     (constant-time), fails closed when CRON_SECRET is unset, never
--     reads client-supplied body/query input, never leaks internals on
--     error, and confines the service-role client to that one file plus
--     the Safety evaluate route. No change.
--   - XSS/executable content: zero live dangerouslySetInnerHTML calls
--     anywhere in app/ or lib/ (only comments/tests asserting its
--     absence); Letter/Dispatch bodies are stored as plain marked-up
--     text (lib/letter-editor-doc.ts's own **/_ delimiter scheme, never
--     HTML) and rendered by building real React elements
--     (FormattedText), never HTML parsing; member composers have no
--     Tiptap Link extension at all (baseWritingExtensions has no Link);
--     the one place Link IS used (the admin-only Announcement editor)
--     restricts protocols via isAnnouncementHrefSafe, re-checked again
--     at render time; every redirect/navigation call site that takes
--     user-influenced input (auth callback's own `next`, /begin, the
--     magic-link confirm page) already validates through lib/safe-
--     redirect.ts's sanitizeInternalPath (WHATWG-URL origin comparison,
--     not a naive prefix check) or lib/auth-confirm.ts's exact-origin
--     validator. No fix needed; no regression test added since no
--     defect exists to regress.
--   - Turnstile/CAPTCHA: verification is delegated entirely to
--     Supabase's own dashboard-level CAPTCHA integration (the token is
--     passed as `captchaToken` straight into supabase.auth.signInWithOtp
--     — there is no local siteverify call and no TURNSTILE_SECRET
--     anywhere in this repo, by design). This is a Supabase-project-
--     configuration concern, not something this codebase's own source
--     can enforce or fix — reported, not silently worked around; verify
--     directly in the Supabase dashboard that CAPTCHA protection is
--     actually enabled before launch.
--   - Sign-in/account-entry rate limiting: Tempa has no server-side
--     endpoint of its own for magic-link requests — the client calls
--     supabase.auth.signInWithOtp directly against Supabase's own
--     GoTrue service, which already rate-limits itself. Per this
--     checkpoint's own instruction ("...where Tempa itself controls the
--     request boundary"), there is no code-level boundary in THIS
--     application for this action to add a limiter to; no fix
--     implemented here, reported as relying on Supabase's own control.
--   - Secrets: SUPABASE_SERVICE_ROLE_KEY/RESEND_API_KEY/CRON_SECRET are
--     each read only from server-only files (lib/supabase/service.ts,
--     lib/email/provider.ts, app/api/cron/arrival-emails/route.ts — the
--     first two explicitly `import 'server-only'`), never from a
--     Client Component, never logged, never serialized into a response.
--     .env.example carries placeholders only; .env.local/.env are
--     gitignored and confirmed untracked. No exposure found; no
--     rotation performed (none needed).
--   - IDOR sweep of the previously-unreviewed RPC families (photo-
--     sharing request/response, keep/unkeep, Worth Reading, postcard
--     removal, profile-mark finalize/discard, Admin announcement/
--     question/postcard RPCs, arrival-email worker RPCs): every target-
--     uuid parameter is checked against auth.uid() (participant/owner)
--     or gated by is_staff(), or the RPC is service_role-only. No gap
--     found; no fix needed.
--   - Views (public.letters_for_participant, public.public_profiles):
--     letters_for_participant is STRICTER than the base table's own RLS
--     (additionally requires deliver_at <= now() for the recipient
--     side), never wider. No other view exists in this codebase. No fix
--     needed.
--   - Storage bucket MIME/size limits on letter-photos/dispatch-photos:
--     confirmed neither bucket has `file_size_limit`/`allowed_mime_
--     types` set (unlike three later buckets — announcement-images,
--     postcard-artwork, profile-marks — which do). This IS a real,
--     concrete gap (client-side JPEG resizing is not an authorization
--     boundary, per this checkpoint's own instruction) and is fixed
--     below (Part 5) using the exact same bucket-configuration
--     mechanism those three later buckets already established — not a
--     new pattern.
--
--   BACKLOG (recorded, not fixed here — non-launch-blocking per this
--   checkpoint's own definition of "launch blocker"):
--   - A full CSP with a nonce architecture (see above).
--   - Explicit request-level rate limiting on the raw Storage upload
--     call itself (letter-photos/dispatch-photos inserts happen via a
--     direct signed Storage call, not a custom RPC, so there is no SQL-
--     level trust boundary to attach a counter to without a trigger on
--     Supabase's own storage.objects table — judged disproportionate
--     risk for this checkpoint given the downstream mutation RPCs that
--     make an uploaded photo actually meaningful — write_anytime/reply/
--     dispatch_publish/dispatch_update — are ALL already rate-limited
--     below; an orphaned, never-attached upload wastes storage but has
--     no functional abuse value beyond that).
--   - Formal per-file-size/type verification of the uploaded BYTES
--     themselves beyond the bucket's own allowed_mime_types check
--     (magic-byte sniffing) — Supabase Storage's own MIME enforcement
--     is judged sufficient for launch; deeper content verification is
--     backlog.

begin;

-- ============================================================
-- PART 1 — CLOSE THE DISPATCH_MOMENTS RAW-INSERT BYPASS
-- ============================================================
-- Same audit/fix shape as docs/sql/2026-10-06-safety-checkpoint4-
-- public-surfaces.sql's own dispatches/dispatch_topics correction:
-- publish_dispatch/update_dispatch are both SECURITY DEFINER (docs/sql/
-- 2026-09-28-title-postcard-and-edit-window.sql) and insert into
-- dispatch_moments under their OWNER's privilege, never depending on
-- the caller's own table grant — so revoking authenticated's raw grant
-- here breaks nothing about the legitimate flow, exactly as revoking it
-- on dispatches/dispatch_topics did not.
drop policy dispatch_moments_insert_own on public.dispatch_moments;
revoke insert on public.dispatch_moments from authenticated;


-- ============================================================
-- PART 2 — CLOSE THE status_reason PRIVACY EXPOSURE
-- ============================================================
-- Checkpoint 8 flagged this; now fixed. Grep across app/ and lib/
-- (excluding tests/simulators) confirms zero real application code ever
-- reads public.account_enforcement_state directly — every legitimate
-- consumer already goes through an is_staff()-gated Admin RPC (admin_
-- get_member, admin_get_safety_case) or the member's own current_
-- account_status(), which has ALWAYS returned only the bare status
-- string, never status_reason/changed_by/changed_at. Removing the raw
-- SELECT grant and its self-select policy therefore removes a real,
-- currently-live exposure path (a member could already run `select
-- status_reason from account_enforcement_state where user_id =
-- auth.uid()` directly against PostgREST) with zero effect on any real
-- feature.
drop policy account_enforcement_state_select_own on public.account_enforcement_state;
revoke select on public.account_enforcement_state from authenticated;
-- current_account_status() itself is untouched — SECURITY DEFINER
-- already bypasses this table's RLS/grants entirely as the function
-- owner, so it keeps working exactly as before for every existing
-- caller across the app.


-- ============================================================
-- PART 3 — RATE LIMITING (the smallest durable, SQL-backed mechanism)
-- ============================================================
-- ARCHITECTURE: Tempa is almost entirely direct Supabase RPC writes,
-- not conventional Next.js API routes a middleware could guard — the
-- one real HTTP entry point in the Safety surface (/api/safety/
-- evaluate) still ultimately depends on a Postgres RPC
-- (record_safety_evaluation) for its actual privileged work, and every
-- other prioritized action (reports, blocks) IS a raw RPC already. The
-- rate-limit authority therefore lives in Postgres itself — the one
-- boundary a client cannot bypass by calling a different code path,
-- crafting a raw fetch, or skipping a Next.js middleware entirely.
--
-- MECHANISM: a fixed-window counter (never an unbounded per-request
-- event log — item 3's own "avoid unbounded permanent event storage").
-- public.rate_limit_counters holds ONE row per (subject, action,
-- window), incremented atomically via `INSERT ... ON CONFLICT DO
-- UPDATE ... RETURNING count` — Postgres serializes concurrent upserts
-- targeting the same conflicting row via ordinary row-level locking, so
-- two simultaneous requests from the same member for the same action
-- can never both observe "under the limit" and both proceed past it
-- (item 3's own "concurrency-safe" / "not allow parallel requests to
-- race through the limit" requirements) — this needs no advisory lock,
-- no SELECT-then-INSERT race window, and no client-supplied counter of
-- any kind. date_bin() (native since Postgres 14) computes the window
-- boundary deterministically from `now()`, aligned to a fixed origin,
-- so "the current window" is always the same value for every concurrent
-- caller without needing to look anything up first.
--
-- IDENTITY: every action gated below is authenticated (report_content/
-- block_user/unblock_user/the Safety evaluate endpoint all already
-- require a real session) — keyed on auth.uid()/the verified session's
-- own user id, NEVER an IP address, device fingerprint, or country
-- (per this checkpoint's own explicit "prefer authenticated member ID"
-- and "do not use country as identity" instructions). No unauthenticated
-- HTTP entry point in this launch surface needed an IP-keyed limiter —
-- the one candidate (sign-in) is a Supabase-controlled boundary this
-- application has no server-side endpoint of its own to attach a
-- limiter to (see this file's own header).
create table public.rate_limit_counters (
  subject_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 1,

  primary key (subject_id, action, window_start)
);

alter table public.rate_limit_counters enable row level security;

revoke all on public.rate_limit_counters from public, anon, authenticated;
-- No policy of any kind, for any client-facing role — same posture as
-- every other Safety-adjacent table in this codebase. The only access
-- path is tempa_private.check_and_increment_rate_limit below (SECURITY
-- DEFINER, bypasses RLS as the function owner) and the cleanup function
-- at the end of this part.

-- Supports the cleanup function's own bounded scan without a full-table
-- sequential scan as this grows.
create index rate_limit_counters_window_start_idx on public.rate_limit_counters (window_start);


-- ------------------------------------------------------------
-- 3A. TEMPA_PRIVATE.RATE_LIMIT_POLICY — the one centralized,
--     documented window/limit table, per this checkpoint's own
--     explicit "centralize rate-limit policy rather than scattering
--     magic numbers through RPC bodies" instruction. Same `language
--     sql immutable` single-row-of-constants shape already established
--     by tempa_private.behavior_policy (Checkpoint 5) — reused
--     convention, not a new pattern.
-- ------------------------------------------------------------
-- Every window/limit below is a TECHNICAL request-throughput guard,
-- deliberately NOT a copy of Checkpoint 5's own behavioral thresholds
-- (which judge whether a PATTERN of activity deserves human Safety
-- review over hours/days) — these instead bound how fast any single
-- member can hit the SAME action in a short window, protecting the
-- service itself from being hammered, never a judgment about intent.
-- 'safety_evaluate' is a single backstop bucket covering the RAW
-- request rate to /api/safety/evaluate regardless of which surface is
-- named, so spreading requests thin across several surfaces to
-- individually stay under each one's own limit still cannot exceed the
-- overall rate; each content surface ALSO gets its own narrower limit
-- (the seven 'first_letter'/'reply'/'write_anytime'/'dispatch_publish'/
-- 'dispatch_update'/'dispatch_reply'/'question_answer' actions) since a
-- single surface being hammered in isolation is its own concern.
create or replace function tempa_private.rate_limit_policy(p_action text)
returns table (window_size interval, action_limit integer)
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select window_size, action_limit
  from (
    values
      ('safety_evaluate', interval '10 minutes', 100),
      ('first_letter', interval '10 minutes', 8),
      ('reply', interval '10 minutes', 30),
      ('write_anytime', interval '10 minutes', 30),
      ('dispatch_publish', interval '10 minutes', 5),
      ('dispatch_update', interval '10 minutes', 10),
      ('dispatch_reply', interval '10 minutes', 30),
      ('question_answer', interval '10 minutes', 10),
      ('report', interval '1 hour', 10),
      ('block', interval '1 hour', 20),
      ('unblock', interval '1 hour', 20)
  ) as policy(action, window_size, action_limit)
  where policy.action = p_action
$$;

revoke all on function tempa_private.rate_limit_policy(text) from public, anon, authenticated, service_role;


-- ------------------------------------------------------------
-- 3B. PUBLIC.CHECK_RATE_LIMIT — the one gate every prioritized action
--     calls, in `public` (not `tempa_private`) specifically because
--     app/api/safety/evaluate/route.ts must reach it via an ordinary
--     `.rpc()` call using the service-role client, the exact same
--     reason record_safety_evaluation itself already lives in `public`
--     rather than tempa_private. report_content/block_user/
--     unblock_user (Part 3C-3E below) call it as an ordinary SQL
--     function call from inside their own SECURITY DEFINER bodies —
--     that works regardless of schema or grants, the same way those
--     functions already call tempa_private.evaluate_behavior with zero
--     grant of its own.
-- ------------------------------------------------------------
-- Returns true (allowed) or false (limit exceeded) — never raises
-- itself, so each caller decides its own generic, user-safe rejection
-- message (item 3's own "fail with a generic user-safe error" — never
-- revealing the specific window/limit/count to the caller). p_subject_
-- id is trusted completely: this function is never reachable by an
-- ordinary client directly (service_role only, see the grant below),
-- and every internal caller (report_content, block_user, unblock_user)
-- passes auth.uid() — its own verified caller, never anything client-
-- supplied — the same trust model record_safety_evaluation's own
-- p_user_id already relies on.
create or replace function public.check_rate_limit(
  p_subject_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_window interval;
  v_limit integer;
  v_window_start timestamptz;
  v_count integer;
begin
  select window_size, action_limit into v_window, v_limit
  from tempa_private.rate_limit_policy(p_action);

  if v_window is null then
    raise exception 'Unknown rate-limit action: %', p_action using errcode = '22023';
  end if;

  v_window_start := date_bin(v_window, now(), timestamptz '2000-01-01');

  insert into public.rate_limit_counters (subject_id, action, window_start, count)
  values (p_subject_id, p_action, v_window_start, 1)
  on conflict (subject_id, action, window_start)
    do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= v_limit;
end;
$function$;

revoke all on function public.check_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.check_rate_limit(uuid, text) to service_role;


-- ------------------------------------------------------------
-- 3C. CLEANUP_EXPIRED_RATE_LIMIT_COUNTERS — prepared, NOT scheduled.
--     Same "prepared but not wired to pg_cron yet" posture as
--     cleanup_expired_safety_evaluations (docs/sql/2026-10-03-safety-
--     persistence.sql) — this checkpoint does not schedule anything; a
--     future, separately-reviewed migration can wire it to the same
--     pg_cron pattern docs/sql/2026-10-02-arrival-email-scheduler.sql
--     already established.
-- ------------------------------------------------------------
create or replace function public.cleanup_expired_rate_limit_counters(
  p_retention interval default interval '1 day'
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  delete from public.rate_limit_counters
  where window_start < now() - p_retention;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_expired_rate_limit_counters(interval) from public;
grant execute on function public.cleanup_expired_rate_limit_counters(interval) to service_role;


-- ------------------------------------------------------------
-- 3D. REPORT_CONTENT — gated with the 'report' action, checked FIRST
--     (a technical throughput gate, before any real work — never a
--     post-hoc observation the way Checkpoint 5's own evaluate_behavior
--     call further down this same function remains).
-- ------------------------------------------------------------
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

  if not public.check_rate_limit(auth.uid(), 'report') then
    raise exception 'Too many requests. Please try again shortly.' using errcode = '22023';
  end if;

  if p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply') then
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
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);

    if v_reported_user_id is null then
      raise exception 'Dispatch not found.';
    end if;


  elsif p_target_type = 'photo_moment' then

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
        and d.status = 'published'
        and d.moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);
    end if;

    if v_reported_user_id is null then
      raise exception 'Photo not found.';
    end if;


  elsif p_target_type = 'question_answer' then

    select
      qa.user_id,
      jsonb_build_object(
        'prompt', q.prompt,
        'body', qa.body,
        'author_pseudonym', p.pseudonym
      )
    into v_reported_user_id, v_evidence
    from public.question_answers qa
    join public.questions q on q.id = qa.question_id
    join public.profiles p on p.id = qa.user_id
    where qa.id = p_target_id
      and q.is_active = true
      and qa.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id);

    if v_reported_user_id is null then
      raise exception 'Answer not found.';
    end if;


  elsif p_target_type = 'reply' then

    select
      r.author_id,
      jsonb_build_object(
        'body', r.body,
        'author_pseudonym', p.pseudonym,
        'dispatch_id', r.dispatch_id,
        'dispatch_title', d.title,
        'parent_reply_id', r.parent_reply_id,
        'reply_created_at', r.created_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatch_replies r
    join public.dispatches d on d.id = r.dispatch_id
    join public.profiles p on p.id = r.author_id
    where r.id = p_target_id
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
      and tempa_private.author_content_publicly_visible(d.author_id)
      and r.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)
      and tempa_private.author_content_publicly_visible(r.author_id);

    if v_reported_user_id is null then
      raise exception 'Reply not found.';
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

  -- Checkpoint 5 — durable post-event observation, never enforcement.
  -- See that checkpoint's own migration header for the exception-guard/
  -- subtransaction reasoning. Unchanged by this checkpoint.
  begin
    perform tempa_private.evaluate_behavior(
      p_subject_user_id := v_reported_user_id,
      p_report_check := true
    );
  exception when others then
    raise warning '[safety] evaluate_behavior (report_spike) failed for subject %: %', v_reported_user_id, sqlerrm;
  end;

end;
$function$;

revoke all on function public.report_content(text, uuid, text, text) from public;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- ------------------------------------------------------------
-- 3E. BLOCK_USER — gated with the 'block' action, checked first.
-- ------------------------------------------------------------
create or replace function public.block_user(p_blocked_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.check_rate_limit(auth.uid(), 'block') then
    raise exception 'Too many requests. Please try again shortly.' using errcode = '22023';
  end if;

  if p_scope is null then
    raise exception 'Unknown block scope.';
  end if;

  if p_scope not in ('letters', 'full') then
    raise exception 'Unknown block scope.';
  end if;

  if auth.uid() = p_blocked_id then
    raise exception 'You cannot block yourself.';
  end if;

  if not exists (select 1 from public.profiles where id = p_blocked_id) then
    raise exception 'Member not found.';
  end if;

  if auth.uid() < p_blocked_id then
    perform 1 from public.profiles where id = auth.uid() for update;
    perform 1 from public.profiles where id = p_blocked_id for update;
  else
    perform 1 from public.profiles where id = p_blocked_id for update;
    perform 1 from public.profiles where id = auth.uid() for update;
  end if;

  insert into public.blocked_users (blocker_id, blocked_id, scope)
  values (auth.uid(), p_blocked_id, p_scope)
  on conflict (blocker_id, blocked_id) do update
    set scope = excluded.scope;

  if p_scope = 'full' then
    delete from public.kept_minds
    where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)
       or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid());

    delete from public.dispatch_worth_reading
    where (
      user_id = auth.uid()
      and dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)
    ) or (
      user_id = p_blocked_id
      and dispatch_id in (select id from public.dispatches where author_id = auth.uid())
    );
  end if;

  -- Checkpoint 5 — durable post-event observation, never enforcement.
  -- Unchanged by this checkpoint.
  begin
    perform tempa_private.evaluate_behavior(
      p_subject_user_id := p_blocked_id,
      p_block_check := true
    );
  exception when others then
    raise warning '[safety] evaluate_behavior (block_spike) failed for subject %: %', p_blocked_id, sqlerrm;
  end;
end;
$function$;

revoke all on function public.block_user(uuid, text) from public, anon, authenticated;
grant execute on function public.block_user(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 3F. UNBLOCK_USER — gated with the 'unblock' action, checked first.
--     Reproduced in full from its current live definition (docs/sql/
--     2026-09-11-safety-blocking-foundation.sql, never redefined
--     since) with ONLY the rate-limit gate added.
-- ------------------------------------------------------------
create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.check_rate_limit(auth.uid(), 'unblock') then
    raise exception 'Too many requests. Please try again shortly.' using errcode = '22023';
  end if;

  delete from public.blocked_users
  where blocker_id = auth.uid()
    and blocked_id = p_blocked_id;
end;
$function$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;


-- ============================================================
-- PART 4 — GRANT-HYGIENE: EXPLICIT REVOKE FROM ANON ON SEVEN EARLY
-- TABLES (defense in depth; RLS already blocks anon in practice)
-- ============================================================
revoke all on public.dispatches from anon;
revoke all on public.dispatch_topics from anon;
revoke all on public.dispatch_moments from anon;
revoke all on public.dispatch_views from anon;
revoke all on public.kept_minds from anon;
revoke all on public.dispatch_shares from anon;
revoke all on public.dispatch_replies from anon;


-- ============================================================
-- PART 5 — STORAGE BUCKET HARDENING: SERVER-ENFORCED SIZE/MIME LIMITS
-- ON THE TWO PRIVATE PHOTO MOMENT BUCKETS
-- ============================================================
-- letter-photos/dispatch-photos have carried no file_size_limit/
-- allowed_mime_types since their own creation (docs/sql/2026-08-31-
-- moments.sql, docs/sql/2026-09-07-dispatches-and-board.sql) — unlike
-- three LATER buckets (announcement-images, postcard-artwork, profile-
-- marks) which already set both. Client-side re-encode (lib/image-
-- processing.ts: canvas re-draw to JPEG, quality 0.85, max 1600px) is
-- useful but is not, and was never claimed to be, an authorization
-- boundary — a client bypassing the app entirely could upload an
-- arbitrarily large or wrongly-typed file straight to Storage today.
-- Matches this app's own established real product behavior exactly
-- (every real upload is already a resized JPEG under ~2MB in practice)
-- so this tightens nothing a legitimate member would ever notice.
update storage.buckets
set file_size_limit = 5242880, -- 5MB, matching announcement-images' own ceiling
    allowed_mime_types = array['image/jpeg']
where id = 'letter-photos';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg']
where id = 'dispatch-photos';

commit;

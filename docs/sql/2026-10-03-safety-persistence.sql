-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 2: PERSISTENCE + POLICY LAYER
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Does NOT merge to main, deploy, or enable enforcement for real
-- members. No Letter RPC (send_first_letter/reply_to_letter/
-- write_letter) is modified by this migration — this checkpoint builds
-- the evaluation/persistence surface only; wiring the mutation RPCs to
-- consume an evaluation transactionally is Checkpoint 3's job.
-- ============================================================
--
-- Trust boundary this migration exists to enforce (approved
-- architecture, restated here for reviewers):
--
--   member session -> authenticated Route Handler (app/api/safety/
--   evaluate) -> canonical TS classifier (lib/safety/classify.ts) ->
--   this file's server-only service-role recording RPC -> a safety
--   evaluation row.
--
-- Ordinary authenticated/anon users have NO path to mint or mutate a
-- safety evaluation, signal, or case themselves — every table below is
-- RLS-enabled with every grant explicitly revoked from public/anon/
-- authenticated and NO compensating policy for any client role. The
-- only writer is record_safety_evaluation, granted to service_role
-- only. TypeScript never calculates or submits a trusted hash — the
-- Route Handler sends the validated exact mutation fields, and this
-- migration's own SQL helper (tempa_private.safety_fingerprint)
-- constructs the fingerprint server-side, the one canonical
-- implementation later mutation RPCs (Checkpoint 3) will also call
-- over their own actual received fields, rather than each RPC growing
-- its own hashing logic.
--
-- Convention followed throughout (same as every prior checkpoint):
-- SECURITY DEFINER functions use `set search_path to 'pg_catalog'`,
-- every object is fully `public.`/`tempa_private.`-qualified, every new
-- table gets an explicit `revoke all ... from public, anon,
-- authenticated` (Supabase projects grant broad default privileges on
-- table creation), and every function gets `revoke all ... from
-- public` then a targeted grant. tempa_private.safety_fingerprint and
-- tempa_private.safety_risk_band_rank are deliberately NOT SECURITY
-- DEFINER — pure computations over their own arguments with no table
-- access, so there is no demonstrated reason to elevate privileges
-- (per this checkpoint's own instruction to keep privileges minimal);
-- they only ever need to be callable from inside the other SECURITY
-- DEFINER functions in this file, which execute under their owning
-- role and need no EXECUTE grant of their own to call another function
-- owned by that same role (same reasoning already established for
-- tempa_private.is_correspondence_blocked_pair, docs/sql/2026-09-12-
-- scoped-blocking-and-fixes.sql).
--
-- PRIVACY: no raw Letter/Dispatch/Postcard text is stored in
-- safety_evaluations, safety_signals, or safety_cases — every row
-- references a subject/context by id only (user_id, surface,
-- context_id), never letter body text. The classifier's own extracted
-- indicators (emails, phone numbers, URLs, wallet addresses —
-- lib/safety's own ExtractedIndicators) are already excluded from
-- ClassificationResult and were never available to persist in the
-- first place (see lib/safety/classify.ts's own doc comment).
--
-- SIGNALS VS. CASES: kept genuinely separate, per this checkpoint's own
-- instruction. safety_signals is one row per individual structured
-- observation (created at EVALUATION time for meaningful/high/severe
-- risk, independent of whether the member goes on to actually send —
-- an abandoned/denied attempt still leaves a signal). safety_cases is
-- the Needs Attention review OBJECT: at most one OPEN case per subject
-- (enforced by a partial unique index), aggregating every escalating
-- signal for that member rather than manufacturing a new independent
-- case per signal. 'none'/'weak' evaluations never create a signal —
-- weak observations are not automatically permanent telemetry merely
-- because they exist.
--
-- RETENTION POLICY (documented here, NOT scheduled — see Part 6):
--   - safety_evaluations: cleaned up (deleted) once
--     `expires_at < now() - retention`, default retention 30 days past
--     the evaluation's own 15-minute expiry — long enough to support a
--     dispute/debugging window, short enough not to become indefinite
--     private-behaviour telemetry by accident. Deleting an evaluation
--     row cascades to delete its safety_signals row too (ON DELETE
--     CASCADE) — this checkpoint deliberately gives signals no
--     independent retention clock from their own evaluation; a
--     signal's whole reason for existing is "this evaluation happened",
--     so it does not outlive that evaluation's own retention.
--   - safety_cases: NOT touched by the cleanup function below at all.
--     A case is a review object with its own open/reviewed/dismissed
--     lifecycle; it must not silently disappear just because the
--     evaluations that originally fed it aged out from under it. A
--     proportionate case-retention policy (e.g. delete long-dismissed/
--     reviewed cases after some multi-month window) is deferred to a
--     later checkpoint, once Staff review (Checkpoint 7) exists to
--     actually act on a case before it could ever be cleaned up.
--   - cleanup_expired_safety_evaluations (Part 6) is PREPARED but NOT
--     scheduled — no pg_cron job is created by this migration. An
--     operator invokes it manually, or a future migration wires it to
--     a schedule, once this design has been reviewed.
--
-- One BEGIN/COMMIT — this is one coherent, all-or-nothing checkpoint; a
-- partial application would leave the recording RPC referencing a
-- fingerprint helper or table that doesn't fully exist yet.

begin;

-- ============================================================
-- 1. EXTENSION — pgcrypto, for the SHA-256 fingerprint helper
-- ============================================================
-- PREFLIGHT (per this checkpoint's own instruction — do not guess
-- pgcrypto's schema): before running this migration against the real
-- database, run
--   select extname, nspname from pg_extension e
--   join pg_namespace n on n.oid = e.extnamespace
--   where extname = 'pgcrypto';
-- If it returns a row with nspname <> 'extensions', DO NOT run the
-- CREATE EXTENSION statement below as written — instead update
-- tempa_private.safety_fingerprint's `extensions.digest(...)` call to
-- schema-qualify with whatever schema that query actually reports, and
-- update this comment to match, before executing. Supabase's
-- documented default is the `extensions` schema (the same schema
-- pg_net installs into — see docs/sql/2026-10-02-arrival-email-
-- scheduler.sql's own Part 1), and pgcrypto ships enabled by default on
-- new Supabase projects, so this statement is EXPECTED to be a no-op
-- confirming that default, not a fresh install — but that expectation
-- has not been confirmed against this project's actual database, hence
-- the preflight query above rather than an assumption.

create extension if not exists pgcrypto with schema extensions;


-- ============================================================
-- 2. TEMPA_PRIVATE.SAFETY_FINGERPRINT — the one canonical fingerprint
--    implementation
-- ============================================================
-- Deliberately NOT SECURITY DEFINER (see this file's own header) and
-- deliberately NOT given an EXECUTE grant to any role — only ever
-- called from inside record_safety_evaluation below (and, in
-- Checkpoint 3, the mutation RPCs it will be wired into), which run
-- under their owning role.
--
-- Length-PREFIXES each field (byte-count-as-text, a colon, then the
-- field's own value) before concatenating, rather than joining fields
-- with a plain delimiter character — a delimiter alone is ambiguous
-- whenever the delimiter itself can appear inside a field's own value
-- (a letter body can contain any character at all). Length-prefixing
-- makes the concatenation unambiguous regardless of what a field
-- contains: knowing exactly how many characters to consume for THIS
-- field is what tells the boundary of the NEXT field's own length
-- prefix, no matter what's inside.
--
-- TypeScript never calculates or submits this value — the Route
-- Handler passes the validated exact fields (p_user_id, p_surface,
-- p_context_id, p_body) and this function alone turns them into the
-- trusted fingerprint. Editing the body, or evaluating under a
-- different surface/context, produces a different fingerprint and
-- therefore requires a fresh evaluation.

create or replace function tempa_private.safety_fingerprint(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_body text
)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select encode(
    extensions.digest(
      convert_to(
        length(p_user_id::text)::text || ':' || p_user_id::text ||
        length(p_surface)::text || ':' || p_surface ||
        length(p_context_id::text)::text || ':' || p_context_id::text ||
        length(coalesce(p_body, ''))::text || ':' || coalesce(p_body, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function tempa_private.safety_fingerprint(uuid, text, uuid, text) from public, anon, authenticated;


-- ============================================================
-- 3. TEMPA_PRIVATE.SAFETY_RISK_BAND_RANK — small ordering helper
-- ============================================================
-- Mirrors lib/safety/reason-codes.ts's own RISK_BAND_ORDER — used only
-- by record_safety_evaluation's case-upsert below to decide whether an
-- incoming evaluation's risk_band should raise an already-open case's
-- highest_risk_band. Pure, no table access, same "no demonstrated
-- reason for SECURITY DEFINER" reasoning as the fingerprint helper
-- above.

create or replace function tempa_private.safety_risk_band_rank(p_band text)
returns integer
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select case p_band
    when 'severe' then 4
    when 'high' then 3
    when 'meaningful' then 2
    when 'weak' then 1
    else 0
  end
$$;

revoke all on function tempa_private.safety_risk_band_rank(text) from public, anon, authenticated;


-- ============================================================
-- 4. SAFETY_EVALUATIONS — one row per classified attempt
-- ============================================================
-- context_id is surface-dependent (the recipient for a first-contact
-- letter, the letter being replied to, or the correspondence for a
-- Write Anytime letter) — the Route Handler owns exactly which id that
-- is per surface (see app/api/safety/evaluate/route.ts and
-- lib/safety/route-contract.ts); this table only ever stores the id,
-- never which specific field it came from beyond `surface` itself.

create table public.safety_evaluations (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in ('first_letter', 'reply', 'write_anytime')),
  context_id uuid not null,

  -- See tempa_private.safety_fingerprint above.
  fingerprint text not null,

  -- The classifier's own three independent axes (lib/safety/
  -- classify.ts's ClassificationResult) — recorded exactly as reported
  -- by the trusted Route Handler, never re-derived here. reason_codes
  -- is left unconstrained (no enumerated CHECK) deliberately — the
  -- taxonomy lives in lib/safety/reason-codes.ts and can grow without a
  -- matching SQL migration; risk_band/mutation_disposition are small,
  -- stable, structural enums that ARE safe to enumerate here.
  risk_band text not null check (risk_band in ('none', 'weak', 'meaningful', 'high', 'severe')),
  reason_codes text[] not null default '{}',
  mutation_disposition text not null check (mutation_disposition in ('allow', 'warn', 'deny')),
  escalate_case boolean not null default false,

  -- Warning semantics — records only what the server actually knows.
  -- `warning_required` is set once, at evaluation time, purely from
  -- mutation_disposition = 'warn'. `warning_acknowledged_at` is set
  -- later (Checkpoint 3, once a member-facing warning UI exists) only
  -- when the member explicitly acknowledges a shown warning — an API
  -- response having been returned is never sufficient to claim "seen",
  -- and this migration's own record_safety_evaluation never sets it.
  warning_required boolean not null default false,
  warning_acknowledged_at timestamptz,

  -- Single-use transactional consumption is designed for here but NOT
  -- wired up by this checkpoint (per this checkpoint's own scope) —
  -- Checkpoint 3's mutation RPCs will consume an evaluation with
  -- exactly `UPDATE public.safety_evaluations SET consumed_at = now()
  -- WHERE id = ... AND consumed_at IS NULL AND expires_at > now()`,
  -- which can only ever succeed once per row. Nothing in THIS migration
  -- ever sets this column.
  consumed_at timestamptz,

  created_at timestamptz not null default now(),
  -- ~15 minutes, per the approved architecture — long enough to cover
  -- "classify, show a warning if needed, member confirms, mutation RPC
  -- consumes it" without leaving a long-lived, reusable clearance
  -- sitting around.
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

-- Supports record_safety_evaluation's own bounded dedup lookup below —
-- "does an unconsumed, unexpired evaluation for this exact (user,
-- surface, context, fingerprint) already exist?" — a partial index
-- scoped to unconsumed rows only, since a consumed evaluation is never
-- a dedup candidate (see that function's own comment).
create index safety_evaluations_dedup_idx
  on public.safety_evaluations (user_id, surface, context_id, fingerprint)
  where consumed_at is null;

create index safety_evaluations_expires_at_idx on public.safety_evaluations (expires_at);

alter table public.safety_evaluations enable row level security;

revoke all on public.safety_evaluations from public, anon, authenticated;
-- Deliberately no policy for any role — a member has no direct read or
-- write path to their own risk band/reason codes/disposition, which
-- would otherwise let them see exactly what the classifier keys on and
-- adversarially tune submissions against it (the approved
-- architecture's "minimize information returned to the member" rule —
-- the Route Handler already returns only a coarse disposition, never
-- this row). Every access goes through record_safety_evaluation below
-- (service-role only) or, in Checkpoint 3, the mutation RPCs it's
-- wired into (also SECURITY DEFINER, runs as owner). Staff visibility
-- is explicitly deferred to Checkpoint 7's narrow, audited admin
-- surface, never a generic SELECT grant here.


-- ============================================================
-- 5. SAFETY_CASES — the Needs Attention review OBJECT, one per subject
--    per open review cycle, aggregating signals
-- ============================================================

create table public.safety_cases (
  id uuid primary key default gen_random_uuid(),

  subject_user_id uuid not null references auth.users(id) on delete cascade,

  -- Deliberately the smallest possible status field, mirroring
  -- public.reports's own "not a case-management workflow" precedent
  -- (docs/sql/2026-09-17-reporting-and-admin-moderation.sql) —
  -- 'reviewed'/'dismissed' both close a case out of the "at most one
  -- open per subject" constraint below; which of the two applies is a
  -- Checkpoint 7 (staff review) concern, not this checkpoint's.
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),

  -- Matches safety_evaluations.risk_band's own domain (not narrowed to
  -- meaningful/high/severe) — escalate_case is a rule-level POLICY
  -- decision (lib/safety/classify.ts's PolicyOverride), independently
  -- settable from a rule's own band per the approved Checkpoint 1
  -- architecture, so a future rule could in principle escalate at a
  -- band this checkpoint's current ruleset never does. The column stays
  -- as permissive as the axis it is actually tracking.
  highest_risk_band text not null check (highest_risk_band in ('none', 'weak', 'meaningful', 'high', 'severe')),
  signal_count integer not null default 1,

  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- At most one OPEN case per subject. record_safety_evaluation's own
-- `on conflict (subject_user_id) where status = 'open' do update`
-- targets exactly this partial unique index, so a second escalating
-- evaluation for a member who already has an open case updates that
-- SAME case (bumping signal_count, raising highest_risk_band if
-- warranted) rather than manufacturing an independent new case per
-- signal. A member can accumulate more than one case over time only
-- across separate review cycles — once a case is 'reviewed'/
-- 'dismissed' (Checkpoint 7), it no longer matches this partial index,
-- and the next escalation opens a fresh one.
create unique index safety_cases_one_open_per_subject
  on public.safety_cases (subject_user_id)
  where status = 'open';

create index safety_cases_status_idx on public.safety_cases (status);

alter table public.safety_cases enable row level security;

revoke all on public.safety_cases from public, anon, authenticated;
-- Deliberately no policy for any role, and no grant to service_role
-- either — every write goes through record_safety_evaluation
-- (SECURITY DEFINER, runs as owner, needs no grant of its own). Staff
-- review access is explicitly Checkpoint 7 scope, through a narrow
-- audited surface — never a generic direct-table SELECT (per this
-- checkpoint's own instruction).


-- ============================================================
-- 6. SAFETY_SIGNALS — individual structured observations
-- ============================================================

create table public.safety_signals (
  id uuid primary key default gen_random_uuid(),

  -- One signal per qualifying evaluation, never more — this UNIQUE
  -- constraint is what makes record_safety_evaluation's own
  -- `on conflict (evaluation_id) do nothing` an actual guarantee.
  evaluation_id uuid not null unique references public.safety_evaluations(id) on delete cascade,

  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  context_id uuid not null,

  -- Created only for meaningful/high/severe evaluations (see
  -- record_safety_evaluation below) — 'none'/'weak' never reach this
  -- table at all, so the domain here is intentionally narrower than
  -- safety_evaluations.risk_band's.
  risk_band text not null check (risk_band in ('meaningful', 'high', 'severe')),
  reason_codes text[] not null default '{}',

  -- Set only when the evaluation that produced this signal also had
  -- escalate_case = true — a meaningful/high signal that never
  -- escalates a case (see lib/safety/classify.ts's independent policy
  -- axes) is still recorded here with case_id left null.
  case_id uuid references public.safety_cases(id) on delete set null,

  created_at timestamptz not null default now()
);

create index safety_signals_user_id_idx on public.safety_signals (user_id);
create index safety_signals_case_id_idx on public.safety_signals (case_id);

alter table public.safety_signals enable row level security;

revoke all on public.safety_signals from public, anon, authenticated;
-- Same reasoning as safety_cases above — no policy, no grant to any
-- client role, written only by record_safety_evaluation.


-- ============================================================
-- 7. RECORD_SAFETY_EVALUATION — the one trusted write path
-- ============================================================
-- Service-role only (see the grant at the end of this section) — the
-- Route Handler authenticates the member's own session FIRST (via the
-- ordinary per-request Supabase client, never trusting a request-body
-- user id) and only then calls this function, server-side, with the
-- service-role client. There is no path from an authenticated/anon
-- client directly to this function at all; the grant itself is the
-- boundary, matching this repo's established "worker-only RPC" pattern
-- (docs/sql/2026-10-01-arrival-email-delivery.sql's own header note).
--
-- Bounded dedup/idempotency: before inserting anything, looks for an
-- existing UNCONSUMED, UNEXPIRED evaluation for the exact same (user,
-- surface, context, fingerprint) and, if found, returns THAT evaluation
-- unchanged rather than inserting a new row or creating a new signal —
-- repeated evaluation of unchanged content must not generate unlimited
-- rows. Edited content produces a different fingerprint (see
-- tempa_private.safety_fingerprint) and is therefore never matched by
-- this lookup, so it always gets a fresh evaluation. A CONSUMED
-- evaluation is never a dedup candidate (the lookup's own `consumed_at
-- is null` filter) — a second mutation attempt over identical content
-- after the first evaluation was consumed always gets a brand-new
-- evaluation (and, if still meaningful/high/severe, a brand-new
-- signal), never a reused, already-spent one.
--
-- Signal/case behavior: a meaningful/high/severe evaluation always
-- creates its own signal at evaluation time (independent of whether the
-- member ever actually completes the mutation — Checkpoint 3's
-- consumption step is a separate concern from signal creation here).
-- escalate_case = true additionally opens/updates the caller's single
-- open case (see safety_cases_one_open_per_subject above) rather than
-- creating an independent case per signal.

create or replace function public.record_safety_evaluation(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_body text,
  p_risk_band text,
  p_reason_codes text[],
  p_mutation_disposition text,
  p_escalate_case boolean
)
returns table (
  evaluation_id uuid,
  expires_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
  v_new_id uuid;
  v_expires_at timestamptz;
  v_case_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.' using errcode = '22004';
  end if;

  if p_surface not in ('first_letter', 'reply', 'write_anytime') then
    raise exception 'Unknown safety surface: %', p_surface using errcode = '22023';
  end if;

  if p_context_id is null then
    raise exception 'p_context_id is required.' using errcode = '22004';
  end if;

  if p_body is null or length(trim(both from p_body)) = 0 then
    raise exception 'p_body must not be empty.' using errcode = '22023';
  end if;

  if p_risk_band not in ('none', 'weak', 'meaningful', 'high', 'severe') then
    raise exception 'Unknown risk band: %', p_risk_band using errcode = '22023';
  end if;

  if p_mutation_disposition not in ('allow', 'warn', 'deny') then
    raise exception 'Unknown mutation disposition: %', p_mutation_disposition using errcode = '22023';
  end if;

  v_fingerprint := tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_body);

  select e.id, e.expires_at
  into v_existing_id, v_existing_expires_at
  from public.safety_evaluations e
  where e.user_id = p_user_id
    and e.surface = p_surface
    and e.context_id = p_context_id
    and e.fingerprint = v_fingerprint
    and e.consumed_at is null
    and e.expires_at > now()
  order by e.created_at desc
  limit 1;

  if v_existing_id is not null then
    return query select v_existing_id, v_existing_expires_at, false;
    return;
  end if;

  v_expires_at := now() + interval '15 minutes';

  insert into public.safety_evaluations (
    user_id, surface, context_id, fingerprint,
    risk_band, reason_codes, mutation_disposition, escalate_case,
    warning_required, expires_at
  ) values (
    p_user_id, p_surface, p_context_id, v_fingerprint,
    p_risk_band, coalesce(p_reason_codes, '{}'), p_mutation_disposition, p_escalate_case,
    (p_mutation_disposition = 'warn'), v_expires_at
  )
  returning id into v_new_id;

  if p_escalate_case then
    insert into public.safety_cases (subject_user_id, status, highest_risk_band, signal_count)
    values (p_user_id, 'open', p_risk_band, 1)
    on conflict (subject_user_id) where status = 'open'
    do update set
      signal_count = public.safety_cases.signal_count + 1,
      highest_risk_band = case
        when tempa_private.safety_risk_band_rank(excluded.highest_risk_band)
           > tempa_private.safety_risk_band_rank(public.safety_cases.highest_risk_band)
        then excluded.highest_risk_band
        else public.safety_cases.highest_risk_band
      end,
      updated_at = now()
    returning id into v_case_id;
  end if;

  if p_risk_band in ('meaningful', 'high', 'severe') then
    insert into public.safety_signals (evaluation_id, user_id, surface, context_id, risk_band, reason_codes, case_id)
    values (v_new_id, p_user_id, p_surface, p_context_id, p_risk_band, coalesce(p_reason_codes, '{}'), v_case_id)
    on conflict (evaluation_id) do nothing;
  end if;

  return query select v_new_id, v_expires_at, true;
end;
$function$;

revoke all on function public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean) from public;
grant execute on function public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean) to service_role;


-- ============================================================
-- 8. CLEANUP_EXPIRED_SAFETY_EVALUATIONS — prepared, NOT scheduled
-- ============================================================
-- See this file's own "RETENTION POLICY" header for the full rationale.
-- No pg_cron job is created by this migration — this function exists so
-- the retention policy is executable and reviewable now, not so it runs
-- automatically yet. An operator invokes it manually
-- (`select public.cleanup_expired_safety_evaluations();`), or a future,
-- separately-reviewed migration wires it to a schedule (the same
-- pg_cron + pg_net pattern docs/sql/2026-10-02-arrival-email-
-- scheduler.sql already established for the arrival-email worker).

create or replace function public.cleanup_expired_safety_evaluations(
  p_retention interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  delete from public.safety_evaluations
  where expires_at < now() - p_retention;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_expired_safety_evaluations(interval) from public;
grant execute on function public.cleanup_expired_safety_evaluations(interval) to service_role;

commit;

-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 2: PERSISTENCE + POLICY LAYER
-- (extended in place for Checkpoint 3's persistence-layer
-- prerequisites — see Part 9's own header for what those are; still
-- one coherent, still-unapplied migration, not two)
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Does NOT merge to main, deploy, or enable enforcement for real
-- members. No Letter RPC (send_first_letter/reply_to_letter/
-- write_letter) is modified by THIS migration — Checkpoint 3's actual
-- wiring of those three mutation RPCs to consume an evaluation
-- transactionally is a separate, later-dated migration (docs/sql/
-- 2026-10-05-safety-checkpoint3-letter-wiring.sql), which calls Part 9's
-- tempa_private.consume_safety_evaluation, prepared here.
-- ============================================================
--
-- Trust boundary this migration exists to enforce (approved
-- architecture, restated here for reviewers):
--
--   member session -> authenticated Route Handler (app/api/safety/
--   evaluate) -> public.can_evaluate_safety_context (member's own
--   session, proves the context is real and theirs) -> canonical TS
--   classifier (lib/safety/classify.ts) -> this file's server-only
--   service-role recording RPC -> a safety evaluation row.
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
-- the Needs Attention review OBJECT, with the full canonical Safety 2
-- lifecycle: 'open' | 'reviewing' | 'no_action' | 'warned' |
-- 'restricted' | 'suspended' | 'banned' | 'resolved'. Only 'open' and
-- 'reviewing' count as ACTIVE for the one-active-case-per-subject
-- invariant (enforced by a partial unique index over exactly those two
-- statuses) — every other status has closed the review cycle, so the
-- next escalation opens a fresh case. This checkpoint never transitions
-- a case's status itself (record_safety_evaluation only ever inserts at
-- 'open' or updates an already-active case's own aggregate fields); the
-- actual Admin workflow that moves a case through this lifecycle is
-- Checkpoint 7's job.
--
-- CONTEXT AUTHORIZATION: record_safety_evaluation trusts p_context_id
-- completely — it is the Route Handler's job (via
-- public.can_evaluate_safety_context, Part 8 below, called with the
-- member's own authenticated session, never the service-role client)
-- to prove BEFORE ever calling this RPC that the caller is legitimately
-- entitled to operate on that context under the same rules the real
-- Letter RPCs themselves enforce. An authenticated member must not be
-- able to manufacture a signal or open a case merely by posting
-- syntactically-valid UUIDs for a recipient/letter/correspondence they
-- have no real relationship to.
--
-- RETENTION POLICY (documented here, NOT scheduled — see Part 9):
--   - safety_evaluations: cleaned up (deleted) once
--     `expires_at < now() - retention`, default retention 30 days past
--     the evaluation's own 15-minute expiry — long enough to support a
--     dispute/debugging window, short enough not to become indefinite
--     private-behaviour telemetry by accident. Deleting an evaluation
--     row cascades to delete its safety_signals row too (ON DELETE
--     CASCADE) — signals have no independent retention clock from their
--     own evaluation. EXCEPT: an evaluation whose signal is attached to
--     an ACTIVE case ('open' or 'reviewing') is never selected for
--     cleanup at all, regardless of age — a Needs Attention case must
--     never be left saying "N signals occurred" with fewer than N
--     signals actually still there to inspect. Once that case closes
--     (moves to any non-active status), its signals' evaluations become
--     eligible for cleanup again on the next run, same as any other.
--   - safety_cases: NOT touched by the cleanup function below at all.
--     A case is a review object with its own multi-state lifecycle; it
--     must not silently disappear just because the evaluations that
--     originally fed it eventually age out. A proportionate case-
--     retention policy (e.g. delete long-closed cases after some multi-
--     month window) is deferred to a later checkpoint, once Staff
--     review (Checkpoint 7) exists to actually act on a case before it
--     could ever be cleaned up.
--   - cleanup_expired_safety_evaluations (Part 9) is PREPARED but NOT
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
-- Length-PREFIXES each field (its own `length()` — Postgres character
-- count, taken BEFORE the final convert_to(..., 'UTF8') — not a byte/
-- octet count; the two only diverge for non-ASCII content, and nothing
-- here depends on which one it is, only that the same field always
-- produces the same prefix) then a colon then the field's own value,
-- before concatenating — rather than joining fields with a plain
-- delimiter character, which is ambiguous whenever the delimiter
-- itself can appear inside a field's own value (a letter body can
-- contain any character at all). Length-prefixing makes the
-- concatenation unambiguous regardless of what a field contains:
-- knowing exactly how many characters to consume for THIS field is
-- what tells the boundary of the NEXT field's own length prefix, no
-- matter what's inside.
--
-- TypeScript never calculates or submits this value — the Route
-- Handler passes the validated exact fields (p_user_id, p_surface,
-- p_context_id, p_body) and this function alone turns them into the
-- trusted fingerprint. Editing the body, or evaluating under a
-- different surface/context, produces a different fingerprint and
-- therefore requires a fresh evaluation.

-- p_question_answer_id: null for reply/write_anytime, and the actual
-- Question-answer id for first_letter — binding it into the fingerprint
-- (not just context_id, which is the RECIPIENT for first_letter, not
-- the specific Discovery entry) means an evaluation produced for one
-- Question-answer can never be replayed as clearance for a different
-- first-contact context to the same recipient. coalesce'd to '' exactly
-- like p_body, so a null vs. an empty string can never collide.
--
-- p_postcard: null when no Postcard is attached (always null for
-- first_letter, which has no Postcard at all — Checkpoint 3's own
-- correction), or the EXACT jsonb payload reply/write_anytime's real
-- mutation RPC (write_letter/reply_to_letter) will itself receive as
-- p_postcard — same shape, not a re-derived summary, so the mutation
-- RPC can recompute this exact fingerprint from its own actual received
-- p_postcard at consumption time (tempa_private.consume_safety_
-- evaluation below). `::text` on a jsonb value is Postgres's own
-- canonical serialization (normalized key order, no insignificant
-- whitespace) — two jsonb values that are semantically equal always
-- serialize identically, so this is a safe, deterministic fingerprint
-- input, not a byte-for-byte comparison of whatever the client
-- literally sent. Changing the Postcard (or removing/adding one) after
-- evaluation produces a different fingerprint and therefore requires a
-- fresh evaluation, exactly like editing the body.

create or replace function tempa_private.safety_fingerprint(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_postcard jsonb,
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
        length(coalesce(p_question_answer_id::text, ''))::text || ':' || coalesce(p_question_answer_id::text, '') ||
        length(coalesce(p_postcard::text, ''))::text || ':' || coalesce(p_postcard::text, '') ||
        length(coalesce(p_body, ''))::text || ':' || coalesce(p_body, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function tempa_private.safety_fingerprint(uuid, text, uuid, uuid, jsonb, text) from public, anon, authenticated;


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

  -- The specific Question-answer (Discovery entry) a first_letter
  -- evaluation was actually bound to via can_evaluate_safety_context and
  -- the fingerprint above — mirrors send_first_letter's own
  -- p_question_answer_id (docs/sql/2026-09-30-mark-identity-and-admin-
  -- member-workspace.sql). context_id alone (the RECIPIENT for
  -- first_letter) is not specific enough: this column is what actually
  -- ties an evaluation to the real mutation context. Structurally
  -- required for first_letter and structurally forbidden for the other
  -- two surfaces, which have no Question-answer at all.
  question_answer_id uuid,
  constraint safety_evaluations_question_answer_id_matches_surface
    check ((surface = 'first_letter') = (question_answer_id is not null)),

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

  -- Warning semantics — records only what the server actually knows, at
  -- each of four distinct moments, never conflating them (deliberately
  -- never a field called "warning_seen" — an API response having been
  -- returned is not evidence anything was ever shown to, let alone
  -- read by, the member):
  --   1. warning REQUIRED — set once, at evaluation time, purely from
  --      mutation_disposition = 'warn'.
  --   2. warning ISSUED — `warning_issued_at`, set by record_safety_
  --      evaluation itself (Checkpoint 3), in the SAME insert as the
  --      evaluation row, at the instant the server actually serves that
  --      warning copy to the member — the HTTP response this very
  --      request produces (buildEvaluateResponse) IS that instant; there
  --      is no separate later moment to distinguish it from.
  --   3. warning ACKNOWLEDGED — `warning_acknowledged_at`, set only by
  --      tempa_private.consume_safety_evaluation (Checkpoint 3, called
  --      from inside the real Letter mutation RPCs), only when the
  --      member's own p_warning_acknowledged is explicitly true — never
  --      inferred from the warning merely having been issued.
  --   4. mutation actually PROCEEDED — `consumed_at` below; set only by
  --      tempa_private.consume_safety_evaluation, in the SAME
  --      transaction as the real Letter mutation, so `consumed_at` being
  --      set is exactly "the member's send went through" — if the
  --      mutation later fails for any reason, this update rolls back
  --      with it, needing no special-casing beyond both happening in one
  --      transaction.
  warning_required boolean not null default false,
  warning_issued_at timestamptz,
  warning_acknowledged_at timestamptz,

  -- Single-use transactional consumption — tempa_private.consume_
  -- safety_evaluation (Part 9 below) sets this with exactly
  -- `UPDATE public.safety_evaluations SET consumed_at = now() WHERE
  -- id = ... AND consumed_at IS NULL AND expires_at > now()`, which can
  -- only ever succeed once per row. record_safety_evaluation itself
  -- never sets this column — only consumption does.
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

  -- The full canonical Safety 2 case lifecycle (not the earlier
  -- open/reviewed/dismissed placeholder) — which specific status a case
  -- moves through is entirely a Checkpoint 7 (staff review/Admin
  -- workflow) concern; this checkpoint only ever inserts at 'open' and
  -- otherwise leaves status untouched. 'open' and 'reviewing' are the
  -- two ACTIVE statuses for the "at most one active case per subject"
  -- constraint below — every other status has closed the review cycle.
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'no_action', 'warned', 'restricted', 'suspended', 'banned', 'resolved')),

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

-- At most one ACTIVE ('open' or 'reviewing') case per subject.
-- record_safety_evaluation's own `on conflict (subject_user_id) where
-- status in ('open', 'reviewing') do update` targets exactly this
-- partial unique index, so a second escalating evaluation for a member
-- who already has an active case updates that SAME case (bumping
-- signal_count, raising highest_risk_band if warranted) rather than
-- manufacturing an independent new case per signal. A member can
-- accumulate more than one case over time only across separate review
-- cycles — once a case moves to any non-active status (Checkpoint 7),
-- it no longer matches this partial index, and the next escalation
-- opens a fresh one.
create unique index safety_cases_one_active_per_subject
  on public.safety_cases (subject_user_id)
  where status in ('open', 'reviewing');

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

  -- Created for meaningful/high/severe evaluations, AND for any
  -- evaluation that escalates a case regardless of band (see
  -- record_safety_evaluation below) — escalate_case is a rule-level
  -- POLICY decision independently settable from a rule's own band (per
  -- the Checkpoint 1 architecture), so a weak- or even none-banded
  -- evaluation can still legitimately escalate a case. The domain here
  -- therefore matches safety_evaluations.risk_band's full domain: a case
  -- must never carry a signal_count that outruns its actual linked
  -- signals, which would happen if an escalating weak/none evaluation
  -- bumped signal_count but had nowhere to record itself here.
  risk_band text not null check (risk_band in ('none', 'weak', 'meaningful', 'high', 'severe')),
  reason_codes text[] not null default '{}',

  -- Set only when the evaluation that produced this signal also had
  -- escalate_case = true — a meaningful/high signal that never
  -- escalates a case (see lib/safety/classify.ts's independent policy
  -- axes) is still recorded here with case_id left null.
  case_id uuid references public.safety_cases(id) on delete set null,

  -- Checkpoint 3: links an evaluation-time signal to the specific
  -- content it turned out to be about, once (and only if/when) the
  -- member actually proceeds with the mutation. A signal can exist
  -- before any Letter does (evaluation happens before send), so this
  -- starts null and is filled in by tempa_private.consume_safety_
  -- evaluation, in the SAME transaction as the real Letter insert, only
  -- on a successful proceed — never on a denied/abandoned/warned-but-
  -- not-sent attempt. Structured and privacy-minimal: an id only, never
  -- a copy of the Letter's own body. proceeded_at is this signal's own
  -- durable "the member actually went ahead" marker for Checkpoint 7
  -- review, kept separate from the evaluation's own consumed_at (which
  -- exists regardless of whether THIS evaluation ever produced a
  -- signal at all).
  source_content_id uuid,
  proceeded_at timestamptz,

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
-- Bounded dedup/idempotency, now CONCURRENCY-SAFE: a plain "SELECT
-- existing, if none INSERT" is a textbook race under two concurrent
-- identical requests (both SELECTs can see "nothing yet" before either
-- INSERT commits). Before the lookup, takes a TRANSACTION-scoped
-- advisory lock (`pg_advisory_xact_lock`, released automatically at
-- commit/rollback, never leaked) keyed off the first 64 bits of the
-- fingerprint itself — the fingerprint already uniquely identifies the
-- exact (user, surface, context, body) tuple this dedup identity is
-- about, so hashing it again would only add collision risk, not remove
-- it. A second concurrent call with the IDENTICAL fingerprint blocks on
-- this lock until the first call's transaction finishes, then proceeds
-- and correctly observes whatever the first call committed — two
-- concurrent identical evaluations can never both insert.
--
-- Looks for an existing UNCONSUMED, UNEXPIRED evaluation for the exact
-- same (user, surface, context, fingerprint). If found AND its stored
-- classifier/policy tuple (risk_band, reason_codes, mutation_
-- disposition, escalate_case) EXACTLY matches what THIS call was just
-- given, returns that evaluation unchanged — repeated evaluation of
-- unchanged content must not generate unlimited rows. If found but that
-- tuple DIFFERS (the classifier's current behavior for this exact
-- content no longer agrees with what was recorded — e.g. a deploy
-- landed between the two calls), the stale row is immediately expired
-- (never left sitting around to be matched again) and a FRESH
-- evaluation is recorded below instead — a clearance is never silently
-- reused when its stored decision disagrees with what the classifier
-- just produced. Edited content produces a different fingerprint (see
-- tempa_private.safety_fingerprint) and is therefore never matched by
-- this lookup at all, so it always gets a fresh evaluation regardless.
-- A CONSUMED evaluation is never a dedup candidate (the lookup's own
-- `consumed_at is null` filter) — a second mutation attempt over
-- identical content after the first evaluation was consumed always gets
-- a brand-new evaluation (and, if still meaningful/high/severe, a
-- brand-new signal), never a reused, already-spent one.
--
-- Signal/case behavior: a meaningful/high/severe evaluation always
-- creates its own signal at evaluation time (independent of whether the
-- member ever actually completes the mutation — Checkpoint 3's
-- consumption step is a separate concern from signal creation here).
-- escalate_case = true additionally opens/updates the caller's single
-- ACTIVE case (see safety_cases_one_active_per_subject above) rather
-- than creating an independent case per signal — AND, because
-- escalate_case is a POLICY axis independent from risk_band, also
-- guarantees a signal even when the band itself is weak or none: a case
-- must never report a signal_count with fewer actual linked signals
-- than that count claims (see safety_signals' own widened risk_band
-- domain above).
--
-- CONTEXT AUTHORIZATION is NOT this function's job — see this file's
-- own header and public.can_evaluate_safety_context (Part 8) below;
-- this function trusts p_user_id/p_context_id completely, exactly like
-- every other service-role-only worker RPC in this codebase trusts its
-- own validated parameters.

create or replace function public.record_safety_evaluation(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_postcard jsonb,
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
  v_lock_key bigint;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
  v_existing_risk_band text;
  v_existing_reason_codes text[];
  v_existing_mutation_disposition text;
  v_existing_escalate_case boolean;
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

  if p_surface = 'first_letter' and p_question_answer_id is null then
    raise exception 'p_question_answer_id is required for first_letter.' using errcode = '22004';
  end if;

  if p_surface <> 'first_letter' and p_question_answer_id is not null then
    raise exception 'p_question_answer_id is only valid for first_letter.' using errcode = '22023';
  end if;

  if p_surface = 'first_letter' and p_postcard is not null then
    raise exception 'first_letter has no Postcard.' using errcode = '22023';
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

  v_fingerprint := tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_question_answer_id, p_postcard, p_body);

  -- Concurrency guard — see this section's own header comment. Must run
  -- BEFORE the dedup lookup below, not after.
  v_lock_key := ('x' || substr(v_fingerprint, 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select e.id, e.expires_at, e.risk_band, e.reason_codes, e.mutation_disposition, e.escalate_case
  into v_existing_id, v_existing_expires_at, v_existing_risk_band, v_existing_reason_codes,
       v_existing_mutation_disposition, v_existing_escalate_case
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
    if v_existing_risk_band = p_risk_band
       and v_existing_reason_codes = coalesce(p_reason_codes, '{}')
       and v_existing_mutation_disposition = p_mutation_disposition
       and v_existing_escalate_case = p_escalate_case
    then
      return query select v_existing_id, v_existing_expires_at, false;
      return;
    end if;

    -- Stale policy — see this section's own header comment. Invalidate
    -- immediately so it can never be dedup-matched again, then fall
    -- through to record a fresh evaluation below.
    update public.safety_evaluations set expires_at = now() where id = v_existing_id;
  end if;

  v_expires_at := now() + interval '15 minutes';

  -- warning_issued_at is set HERE, not left for a later step: the HTTP
  -- response this same request produces (buildEvaluateResponse, lib/
  -- safety/route-contract.ts) is itself "the server actually serving
  -- that warning copy to the member" — there is no separate later
  -- moment to distinguish it from for a warn disposition.
  insert into public.safety_evaluations (
    user_id, surface, context_id, question_answer_id, fingerprint,
    risk_band, reason_codes, mutation_disposition, escalate_case,
    warning_required, warning_issued_at, expires_at
  ) values (
    p_user_id, p_surface, p_context_id, p_question_answer_id, v_fingerprint,
    p_risk_band, coalesce(p_reason_codes, '{}'), p_mutation_disposition, p_escalate_case,
    (p_mutation_disposition = 'warn'),
    case when p_mutation_disposition = 'warn' then now() else null end,
    v_expires_at
  )
  returning id into v_new_id;

  if p_escalate_case then
    insert into public.safety_cases (subject_user_id, status, highest_risk_band, signal_count)
    values (p_user_id, 'open', p_risk_band, 1)
    on conflict (subject_user_id) where status in ('open', 'reviewing')
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

  -- A case must never gain signal_count without an actual linked
  -- signal — escalate_case is independent from risk_band (see the
  -- header comment and safety_signals' own widened domain above), so a
  -- signal is recorded whenever EITHER condition holds, not only when
  -- the band itself is meaningful/high/severe.
  if p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case then
    insert into public.safety_signals (evaluation_id, user_id, surface, context_id, risk_band, reason_codes, case_id)
    values (v_new_id, p_user_id, p_surface, p_context_id, p_risk_band, coalesce(p_reason_codes, '{}'), v_case_id)
    on conflict (evaluation_id) do nothing;
  end if;

  return query select v_new_id, v_expires_at, true;
end;
$function$;

revoke all on function public.record_safety_evaluation(uuid, text, uuid, uuid, jsonb, text, text, text[], text, boolean) from public;
grant execute on function public.record_safety_evaluation(uuid, text, uuid, uuid, jsonb, text, text, text[], text, boolean) to service_role;


-- ============================================================
-- 8. CAN_EVALUATE_SAFETY_CONTEXT — member-session context authorization,
--    called BEFORE record_safety_evaluation, never with the
--    service-role client
-- ============================================================
-- Because a meaningful/high/severe evaluation creates a signal (and can
-- open a case) independent of whether any mutation ever happens, an
-- authenticated member must not be able to manufacture Safety evidence
-- merely by posting syntactically-valid UUIDs to /api/safety/evaluate
-- for a recipient/letter/correspondence they have no real relationship
-- to. This function is called by the Route Handler using the ordinary
-- per-request Supabase client that carries the member's OWN session —
-- `auth.uid()` below resolves to that real, authenticated caller,
-- exactly like every mutation RPC in this codebase already relies on
-- (send_first_letter/reply_to_letter/write_letter). It is SECURITY
-- DEFINER only because it needs to call tempa_private.
-- is_correspondence_blocked_pair and read public.profiles/letters/
-- correspondences the same way those RPCs already do, not because it
-- trusts anything OTHER than the caller's own session — there is no
-- service-role table read anywhere in this function, and it is granted
-- to `authenticated`, never `service_role`.
--
-- Deliberately reuses EXACTLY the read-only portions of each real
-- mutation RPC's own gate (re-read directly from their current
-- definitions — docs/sql/2026-09-28-title-postcard-and-edit-window.sql
-- — before writing this, not from memory), narrowed to what this
-- function can actually check given the fields the Safety Route Handler
-- itself accepts (see lib/safety/route-contract.ts):
--   - first_letter: mirrors send_first_letter's pre-insert checks IN
--     FULL — recipient exists, not self, caller's account not
--     restricted/suspended/banned, no active block either direction/
--     scope, the supplied p_question_answer_id is a live Discovery
--     entry belonging to that exact recipient (qa.user_id = p_context_id,
--     qa.is_current, q.is_active), AND (Checkpoint 3 correction) the
--     pair's non-established correspondence state: if this pair already
--     has an ACTIVE/established correspondence, a first_letter
--     evaluation is not authorized (send_first_letter itself would
--     refuse with "already established, use write_letter instead"); if
--     the caller has already sent their own root first-contact letter
--     in the current pending episode, likewise not authorized
--     (send_first_letter's own 23505 "already sent" guard). Crossed-
--     direction first contact — the OTHER party having already sent
--     THEIR OWN first-contact letter in a still-pending episode, before
--     either has replied — is deliberately still authorized, exactly
--     matching send_first_letter's own current behavior (its "already
--     sent" check is scoped to `sender_id = auth.uid()`, never to the
--     correspondence as a whole). This lookup is READ-ONLY — it never
--     creates or locks a correspondence row; that remains
--     send_first_letter's own job at actual send time, and this
--     function's own result can still race against a concurrent send
--     (matching every other "may I?" read here) — the real RPC's own
--     FOR UPDATE lock is always the final, authoritative gate.
--   - reply: mirrors reply_to_letter's own row lookup exactly — the
--     letter exists, is addressed to the caller, is 'sent', has reached
--     its own deliver_at, and is still awaiting a reply — PLUS
--     (Checkpoint 3 correction) reply_to_letter's own remaining pre-
--     insert checks this function had omitted: no active block between
--     the pair, caller's account not suspended/banned. A 'restricted'
--     caller may still evaluate a PLAIN-TEXT reply (reply_to_letter
--     itself only blocks restricted from Moments/a Postcard, never
--     plain text) — p_postcard is checked here for exactly that reason:
--     restricted + a Postcard present is not authorized, matching
--     reply_to_letter's own restricted-Postcard gate exactly.
--   - write_anytime: mirrors write_letter's own pre-insert checks —
--     correspondence exists, caller is a participant, no active block,
--     caller's account not suspended/banned, correspondence is
--     'active' with a non-null established_at, and (Checkpoint 3
--     correction, same reasoning as reply above) restricted + a
--     Postcard present is not authorized either.
-- Returns a plain boolean rather than raising, matching this function's
-- read-only "may I?" nature — the Route Handler decides what HTTP
-- status a `false` becomes.

create or replace function public.can_evaluate_safety_context(
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_postcard jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  v_corr public.correspondences;
  v_recipient uuid;
  v_status text;
  v_first_letter_corr public.correspondences;
  v_reply_letter public.letters;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_context_id is null then
    return false;
  end if;

  if p_surface = 'first_letter' then
    if p_context_id = auth.uid() then
      return false;
    end if;

    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_context_id) then
      return false;
    end if;

    if not exists (select 1 from public.profiles where id = p_context_id) then
      return false;
    end if;

    if p_question_answer_id is null then
      return false;
    end if;

    if not exists (
      select 1
      from public.question_answers qa
      join public.questions q on q.id = qa.question_id
      where qa.id = p_question_answer_id
        and qa.user_id = p_context_id
        and qa.is_current = true
        and q.is_active = true
    ) then
      return false;
    end if;

    -- Correspondence-state check — see this section's own header
    -- comment. Read-only: no insert, no FOR UPDATE.
    select * into v_first_letter_corr
    from public.correspondences c
    where c.participant_low = least(auth.uid(), p_context_id)
      and c.participant_high = greatest(auth.uid(), p_context_id)
      and c.status in ('pending', 'active');

    if found then
      if v_first_letter_corr.status = 'active' or v_first_letter_corr.established_at is not null then
        return false;
      end if;

      if exists (
        select 1 from public.letters l
        where l.correspondence_id = v_first_letter_corr.id
          and l.reply_to_id is null
          and l.sender_id = auth.uid()
      ) then
        return false;
      end if;
    end if;

    return true;

  elsif p_surface = 'reply' then
    select * into v_reply_letter
    from public.letters l
    where l.id = p_context_id
      and l.recipient_id = auth.uid()
      and l.status = 'sent'
      and l.deliver_at <= now()
      and (l.reply_to_id is not null or l.expires_at > now());

    if not found then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_reply_letter.sender_id) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null and v_status = 'restricted' then
      return false;
    end if;

    return true;

  elsif p_surface = 'write_anytime' then
    select * into v_corr from public.correspondences where id = p_context_id;

    if not found then
      return false;
    end if;

    if auth.uid() <> v_corr.participant_low and auth.uid() <> v_corr.participant_high then
      return false;
    end if;

    v_recipient := case when auth.uid() = v_corr.participant_low then v_corr.participant_high else v_corr.participant_low end;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_recipient) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null and v_status = 'restricted' then
      return false;
    end if;

    return v_corr.status = 'active' and v_corr.established_at is not null;

  else
    return false;
  end if;
end;
$function$;

revoke all on function public.can_evaluate_safety_context(text, uuid, uuid, jsonb) from public;
grant execute on function public.can_evaluate_safety_context(text, uuid, uuid, jsonb) to authenticated;


-- ============================================================
-- 9. TEMPA_PRIVATE.CONSUME_SAFETY_EVALUATION — Checkpoint 3's one
--    trusted consumption path, called from INSIDE send_first_letter/
--    reply_to_letter/write_letter (docs/sql/2026-10-05-safety-
--    checkpoint3-letter-wiring.sql), never directly by any client
-- ============================================================
-- Not SECURITY DEFINER by grant boundary alone — it IS security
-- definer (needs to read/write safety_evaluations/safety_signals,
-- which have no policy or grant for any client role at all), but it is
-- deliberately given NO EXECUTE grant to authenticated/anon/
-- service_role: it is only ever called from inside the three mutation
-- RPCs above, which are themselves SECURITY DEFINER and run as the
-- same owning role, needing no grant of their own to call this (same
-- reasoning already established for tempa_private.
-- is_correspondence_blocked_pair and tempa_private.safety_fingerprint).
--
-- Locks the evaluation row FOR UPDATE first — the same row a concurrent
-- second consumption attempt (a genuine double-submit, or two tabs)
-- would also try to lock, so the second call blocks until the first
-- commits/rolls back, then correctly sees consumed_at already set and
-- fails with "already been used" rather than racing.
--
-- Every check below raises a distinct, specific exception (never a
-- single generic failure) — these messages are for the CALLING
-- mutation RPC's own error-handling to decide what to show the member;
-- unlike can_evaluate_safety_context (a member-facing "may I?" read),
-- this function's caller already knows the caller is authenticated and
-- is deciding whether ITS OWN mutation may proceed.
--
-- The full verify set, in order:
--   1. evaluation exists;
--   2. belongs to p_user_id (never trusts a request-supplied id without
--      this check — this is what stops one member from spending
--      another member's evaluation);
--   3. surface matches;
--   4. context_id matches;
--   5. question_answer_id matches (IS NOT DISTINCT FROM — both null is
--      a match, for reply/write_anytime, which have none);
--   6. not already consumed;
--   7. not expired;
--   8. the fingerprint RECOMPUTED HERE, from the mutation RPC's own
--      actual received p_body/p_postcard (never a client-supplied
--      hash), exactly matches the evaluation's stored fingerprint —
--      this is what makes editing the body OR the Postcard after
--      evaluation invalidate it: a changed field produces a different
--      recomputed fingerprint, which can never match;
--   9. the stored disposition is respected — 'deny' never proceeds
--      regardless of p_warning_acknowledged; 'warn' proceeds only when
--      p_warning_acknowledged is explicitly true.
-- Only once every check passes does it set consumed_at (and, only when
-- p_warning_acknowledged, warning_acknowledged_at) — and link this
-- evaluation's own signal (if it produced one; a plain UPDATE that
-- matches zero rows otherwise, never an error) to the newly-created
-- Letter via source_content_id/proceeded_at, so Checkpoint 7 review can
-- point at the specific resulting content once the member actually
-- proceeded, per this checkpoint's own signal-to-content requirement.
--
-- Runs inside whatever transaction the CALLING mutation RPC is already
-- in — there is no explicit transaction control here. If anything later
-- in that calling RPC raises (a Postcard/Moments check, the Letter
-- INSERT itself, anything), Postgres's own implicit rollback undoes
-- this function's own UPDATEs right along with it — "Safety consumption
-- must roll back with it" needs no special-casing beyond calling this
-- function from within the same transaction the Letter insert is in.

create or replace function tempa_private.consume_safety_evaluation(
  p_evaluation_id uuid,
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_postcard jsonb,
  p_body text,
  p_warning_acknowledged boolean,
  p_new_content_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_eval public.safety_evaluations;
  v_fingerprint text;
begin
  select * into v_eval
  from public.safety_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'Safety evaluation not found.' using errcode = '22023';
  end if;

  if v_eval.user_id <> p_user_id then
    raise exception 'Safety evaluation does not belong to this member.' using errcode = '22023';
  end if;

  if v_eval.surface <> p_surface then
    raise exception 'Safety evaluation is for a different surface.' using errcode = '22023';
  end if;

  if v_eval.context_id <> p_context_id then
    raise exception 'Safety evaluation is for a different context.' using errcode = '22023';
  end if;

  if v_eval.question_answer_id is distinct from p_question_answer_id then
    raise exception 'Safety evaluation is for a different Question-answer.' using errcode = '22023';
  end if;

  if v_eval.consumed_at is not null then
    raise exception 'This Safety evaluation has already been used.' using errcode = '22023';
  end if;

  if v_eval.expires_at <= now() then
    raise exception 'This Safety evaluation has expired. Please try again.' using errcode = '22023';
  end if;

  v_fingerprint := tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_question_answer_id, p_postcard, p_body);

  if v_fingerprint <> v_eval.fingerprint then
    raise exception 'This content has changed since it was last checked. Please try again.' using errcode = '22023';
  end if;

  if v_eval.mutation_disposition = 'deny' then
    raise exception 'This message cannot be sent.' using errcode = '22023';
  end if;

  if v_eval.mutation_disposition = 'warn' and not p_warning_acknowledged then
    raise exception 'Please acknowledge the warning before sending.' using errcode = '22023';
  end if;

  update public.safety_evaluations
  set
    consumed_at = now(),
    warning_acknowledged_at = case when p_warning_acknowledged then now() else warning_acknowledged_at end
  where id = p_evaluation_id
    and consumed_at is null
    and expires_at > now();

  if not found then
    raise exception 'This Safety evaluation could not be consumed.' using errcode = '22023';
  end if;

  update public.safety_signals
  set source_content_id = p_new_content_id, proceeded_at = now()
  where evaluation_id = p_evaluation_id;
end;
$function$;

revoke all on function tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, jsonb, text, boolean, uuid) from public, anon, authenticated, service_role;


-- ============================================================
-- 10. CLEANUP_EXPIRED_SAFETY_EVALUATIONS — prepared, NOT scheduled
-- ============================================================
-- See this file's own "RETENTION POLICY" header for the full rationale.
-- No pg_cron job is created by this migration — this function exists so
-- the retention policy is executable and reviewable now, not so it runs
-- automatically yet. An operator invokes it manually
-- (`select public.cleanup_expired_safety_evaluations();`), or a future,
-- separately-reviewed migration wires it to a schedule (the same
-- pg_cron + pg_net pattern docs/sql/2026-10-02-arrival-email-
-- scheduler.sql already established for the arrival-email worker).
--
-- Never deletes an evaluation whose signal is attached to a case that
-- is still ACTIVE ('open' or 'reviewing') — cleanup must not orphan an
-- active Needs Attention case from the structured evidence it's
-- actually about, regardless of how old that evaluation has gotten.
-- Once the case closes (moves to any other status), its signals'
-- evaluations become ordinary cleanup candidates again like any other.

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
  delete from public.safety_evaluations e
  where e.expires_at < now() - p_retention
    and not exists (
      select 1
      from public.safety_signals s
      join public.safety_cases c on c.id = s.case_id
      where s.evaluation_id = e.id
        and c.status in ('open', 'reviewing')
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_expired_safety_evaluations(interval) from public;
grant execute on function public.cleanup_expired_safety_evaluations(interval) to service_role;

commit;

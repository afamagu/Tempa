-- ============================================================
-- TEMPA — ADULT ELIGIBILITY + LEGAL ACCEPTANCE GATE
-- PREPARED — NOT EXECUTED. Review, then run in the Supabase SQL editor.
-- ============================================================
--
-- Adds an account-level gate that sits ABOVE the existing profile-
-- onboarding sequence (public.profiles.onboarding_stage, still exactly
-- 'mark' | 'question' | 'complete', untouched by this migration):
--
--   1. ACCOUNT_ELIGIBILITY — one private row per account. Authoritative
--      adult/minor decision, computed here in SQL from a submitted date
--      of birth via tempa_private.calculate_age (below), never the
--      browser's clock, never trusted as a boolean from the client.
--
--   2. LEGAL_ACCEPTANCES — one durable, versioned row per (account,
--      document, version) accepted. Never a single boolean flag, never
--      localStorage, never auth metadata.
--
--   3. TEMPA_PRIVATE.CALCULATE_AGE — the ONE canonical age-on-date
--      rule, deliberately NOT Postgres's built-in age(). Implemented as
--      the exact same plain year/month/day field-comparison algorithm
--      as lib/age.ts's calculateAge, so SQL and TypeScript are
--      guaranteed to agree BY CONSTRUCTION rather than by assuming
--      age()'s own leap-day behavior happens to match. See its own
--      comment below for the February 29 boundary this produces
--      without any special-casing.
--
--   4. TEMPA_PRIVATE.DERIVE_AGE_RANGE — the ONE canonical age-range
--      bucket rule (mirrors lib/age.ts's deriveAgeRangeBucket, which a
--      Postgres function cannot import — intentionally duplicated,
--      documented in both places), built on calculate_age above.
--
--   5. SUBMIT_DOB_ELIGIBILITY — the sole write path for (1). Serializes
--      concurrent calls for the SAME account via a transaction-scoped
--      advisory lock BEFORE reading account_eligibility (see
--      "CONCURRENCY FIX" below), then validates a real, non-future,
--      non-implausible calendar date; computes age via tempa_private.
--      calculate_age; records `eligible` (with the exact DOB retained
--      — see below) or `ineligible` (DOB NOT retained; only the future
--      re-screening date is). Re-synchronizes an existing profile's
--      derived age_range from the newly-confirmed DOB. Once an account
--      is already `eligible` with a confirmed DOB, this RPC never
--      accepts a replacement — see "DOB IMMUTABILITY" below.
--
--   6. ACCEPT_CURRENT_LEGAL_DOCUMENTS — the sole write path for (2).
--      Records acceptance of the Terms of Service AND Community
--      Guidelines versions, in one call, only once eligibility is
--      confirmed. Takes NO version arguments — see "LEGAL VERSION
--      AUTHORITY CORRECTION" below.
--
--   7. PROFILES_ENFORCE_ADULT_ELIGIBILITY — a BEFORE INSERT trigger,
--      the same SHAPE as this table's own existing
--      profiles_force_initial_mark_stage trigger (docs/sql/2026-09-29-
--      your-mark-production.sql), but SECURITY DEFINER (see
--      "TRIGGER PRIVILEGE CORRECTION" below) rather than that sibling
--      trigger's SECURITY INVOKER: defense-in-depth so a profile can
--      never be created for an account that is not currently
--      `eligible`, regardless of what the client attempts directly
--      against the table, and forcibly overwrites age_range from the
--      authoritative DOB rather than trusting whatever (if anything)
--      the client supplied.
--
-- TRIGGER PRIVILEGE CORRECTION (independent audit correction, applied
-- before this migration was ever executed): profiles_enforce_adult_
-- eligibility must call tempa_private.derive_age_range, which is
-- deliberately NOT directly executable by `authenticated` (see its own
-- revoke below) — a new-profile INSERT is an ordinary authenticated
-- statement, unlike the profile UPDATEs inside submit_dob_eligibility,
-- which already run SECURITY DEFINER. A SECURITY INVOKER trigger
-- calling a function `authenticated` cannot itself EXECUTE would fail
-- with a permission error on every legitimate profile creation. Fixed
-- by making the TRIGGER itself SECURITY DEFINER (so its nested call to
-- derive_age_range runs under the trigger function's OWNER privileges,
-- not the inserting session's) — search_path stays fixed, schema
-- qualification stays explicit, and derive_age_range's own grants stay
-- exactly as restrictive as before (no broad tempa_private exposure,
-- no direct grant to authenticated). Because this trigger now runs
-- with elevated privileges, it no longer merely ASSUMES profiles' own
-- (pre-existing, not tracked by this repo's migration history) INSERT
-- policy already guarantees new.id = auth.uid() — it re-asserts that
-- ownership explicitly and independently, as its own backstop.
--
-- DOB IMMUTABILITY (independent audit correction): an already-eligible
-- account calling submit_dob_eligibility again previously overwrote
-- date_of_birth (and the derived age_range) with whatever new DOB was
-- submitted — client-spoofable authoritative age data after the fact.
-- Fixed: once status = 'eligible', this RPC returns the EXISTING
-- persisted decision unchanged and never evaluates the submitted
-- year/month/day at all, checked BEFORE any input validation (the
-- submitted values are never looked at once already eligible). A
-- future deliberate DOB-correction mechanism, if Tempa ever needs one,
-- must be its own separate, controlled flow — not a side effect of
-- resubmitting this RPC.
--
-- CONCURRENCY FIX (independent audit correction): the DOB-immutability
-- guard above is correct for SEQUENTIAL calls, but a genuinely FIRST
-- submission has a race the row-level FOR UPDATE lock in
-- submit_dob_eligibility cannot close on its own — when no
-- account_eligibility row exists yet, FOR UPDATE has nothing to lock,
-- so two concurrent first calls could both observe "no existing row,"
-- independently evaluate different DOBs, and race into the later
-- UPSERT. Fixed by a transaction-scoped PostgreSQL advisory lock
-- (pg_advisory_xact_lock), keyed deterministically from auth.uid()
-- alone (never a client-supplied identifier), acquired BEFORE the
-- account_eligibility read — see submit_dob_eligibility's own comment
-- for the full reasoning. Different accounts do not unnecessarily
-- serialize against each other; the lock releases automatically at
-- this function's own transaction end.
--
-- LEGAL VERSION AUTHORITY CORRECTION (independent audit correction):
-- accept_current_legal_documents previously accepted
-- p_terms_version/p_community_guidelines_version as CLIENT-SUPPLIED
-- text arguments — a modified authenticated client could submit a
-- guessed FUTURE version string before that document version existed,
-- and if lib/legal.ts later happened to adopt that exact string, the
-- stale row would silently satisfy isLegalCurrent() without genuine
-- acceptance of that version. Fixed: the function now takes NO version
-- parameters — the two accepted version strings are SQL CONSTANTs
-- inside the function body, the sole authoritative source, which an
-- authenticated caller cannot choose or influence. They must exactly
-- match lib/legal.ts's CURRENT_TERMS_VERSION/CURRENT_COMMUNITY_
-- GUIDELINES_VERSION — proven by a source-level regression test that
-- imports those TypeScript constants directly (lib/__tests__/
-- adultEligibilityMigration.test.ts). A future legal-document version
-- bump now requires updating BOTH lib/legal.ts AND this function (via
-- a new migration) — updating lib/legal.ts alone is no longer (and was
-- never actually) sufficient on its own. This migration also explicitly
-- DROPs the legacy public.accept_current_legal_documents(text, text)
-- overload before creating the new zero-argument version (see "LEGACY
-- OVERLOAD CLEANUP" beside the function definition below) — CREATE OR
-- REPLACE alone only affects the exact signature it names and would
-- silently leave a client-supplied-version overload reachable if an
-- earlier draft had ever been applied anywhere.
--
-- ADULT DOB RETENTION — deliberate product decision: an ELIGIBLE
-- adult's exact date of birth IS retained (account_eligibility.
-- date_of_birth), for legitimate continuing purposes (reconfirming
-- eligibility, current age, age-range derivation, future birthday/
-- age-dependent features). It is never exposed in any public-readable
-- view, RPC output, or Board/discovery/Dispatch payload — this
-- migration adds no such exposure, and the table's own RLS restricts
-- every row to its own account.
--
-- UNDER-18 HANDLING AND PRIVACY WORDING (corrected — independent audit
-- finding): an ineligible submission does NOT retain the submitted raw
-- DOB in the ordinary date_of_birth field (it is written as NULL).
-- However, `eligible_on` (date_of_birth + 18 years) IS retained, and
-- `eligible_on` is DERIVED DIRECTLY from the submitted DOB — it is NOT
-- an unrelated or irreversible value. Do not describe this design as
-- Tempa "no longer retaining the person's exact birth-date
-- information": the derived eligible_on date remains private account
-- data that could generally be used to infer the underlying birth date
-- (to within the ambiguity introduced by the February 29 special case
-- below). What this design DOES achieve: the raw SUBMITTED value is
-- not stored verbatim in the ordinary adult-DOB field, and only the
-- minimum derived value needed to enforce the age gate (permit a
-- fresh, neutral screening once eligible_on arrives, and prevent an
-- immediate "wrong answer, try again" retry before then) is kept. The
-- future Privacy Notice (not yet published — see this checkpoint's own
-- launch-dependency note) must describe eligible_on accurately as
-- retained, derived, private account data — not as evidence that Tempa
-- discards a minor's birth-date information.
--
-- NO device fingerprinting, IP harvesting, or browser-fingerprint
-- collection is introduced by this migration.
-- ============================================================

begin;

-- ============================================================
-- 1. ACCOUNT_ELIGIBILITY
-- ============================================================
create table public.account_eligibility (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  -- Retained ONLY while status = 'eligible' (see header). NULL for an
  -- ineligible account — see submit_dob_eligibility below.
  date_of_birth date null,

  status text not null
    check (status in ('eligible', 'ineligible', 'review_required')),

  -- Meaningful only for status = 'ineligible': the date on or after
  -- which a fresh, neutral DOB screening is permitted again. Derived
  -- directly from date_of_birth — see this migration's own "UNDER-18
  -- HANDLING AND PRIVACY WORDING" header note before describing this
  -- column as unlinkable from the underlying birth date.
  eligible_on date null,

  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_eligibility enable row level security;

-- A member may read their OWN eligibility state only — never another
-- account's. Nobody, including the owning member, may write this table
-- directly: every mutation is RPC-only (submit_dob_eligibility), the
-- same hardened, RPC-only-from-day-one posture dispatch_worth_reading
-- and dispatch_replies already launched with.
create policy account_eligibility_own
  on public.account_eligibility
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.account_eligibility from public, anon, authenticated;
grant select on public.account_eligibility to authenticated;


-- ============================================================
-- 2. LEGAL_ACCEPTANCES
-- ============================================================
create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  document_type text not null
    check (document_type in ('terms_of_service', 'community_guidelines')),

  document_version text not null,

  accepted_at timestamptz not null default now(),

  -- The same (account, document, version) is never recorded twice —
  -- what makes accept_current_legal_documents' own ON CONFLICT DO
  -- NOTHING correct and harmless to call more than once.
  unique (user_id, document_type, document_version)
);

alter table public.legal_acceptances enable row level security;

create policy legal_acceptances_own
  on public.legal_acceptances
  for select
  to authenticated
  using (auth.uid() = user_id);

-- RPC-only writes, same posture as account_eligibility above.
revoke all on public.legal_acceptances from public, anon, authenticated;
grant select on public.legal_acceptances to authenticated;


-- ============================================================
-- 3. TEMPA_PRIVATE.CALCULATE_AGE — the one canonical age-on-date rule
-- ============================================================
-- Deliberately NOT Postgres's built-in age() — implemented as the
-- exact same plain year/month/day field-comparison algorithm as
-- lib/age.ts's calculateAge, so SQL and TypeScript are guaranteed to
-- agree BY CONSTRUCTION (same transliterated algorithm) rather than by
-- assuming age()'s own leap-day semantics happen to match a boundary
-- this migration never independently verified against a live database
-- (this migration has not been executed — see its own header).
--
-- FEBRUARY 29 BOUNDARY: no special-casing is needed here at all. For a
-- February 29 DOB compared against a January-or-later, day-28-or-
-- earlier "today" in a non-leap year, "day >= dob.day" (28 >= 29) is
-- false, so the birthday has NOT yet been reached that year; the first
-- date in a non-leap year for which the comparison succeeds is March 1
-- (month 3 > month 2). This is the Tempa-wide convention: for a
-- February 29 DOB, when the relevant anniversary year is not a leap
-- year, March 1 is the birthday boundary — the SAME convention
-- tempa_private.calculate_eligible_on (below) uses when computing a
-- FUTURE eligible_on date, so a member's own age check and their
-- stored re-screening date are always self-consistent: on eligible_on
-- itself, this function is guaranteed to report exactly 18.
create or replace function tempa_private.calculate_age(p_dob date, p_today date)
returns integer
language sql
security invoker
set search_path to 'pg_catalog'
immutable
as $$
  select case
    when extract(month from p_today)::int > extract(month from p_dob)::int
      or (
        extract(month from p_today)::int = extract(month from p_dob)::int
        and extract(day from p_today)::int >= extract(day from p_dob)::int
      )
    then extract(year from p_today)::int - extract(year from p_dob)::int
    else extract(year from p_today)::int - extract(year from p_dob)::int - 1
  end
$$;

revoke all on function tempa_private.calculate_age(date, date) from public, anon, authenticated;


-- ============================================================
-- 3b. TEMPA_PRIVATE.CALCULATE_ELIGIBLE_ON — dob + 18 years, the same
-- February 29 convention as calculate_age above
-- ============================================================
-- A February 29 DOB whose +18 target year is not a leap year resolves
-- to MARCH 1 of that year (never February 28) — the exact date on
-- which calculate_age(dob, that date) first returns 18, proven by
-- construction: calculate_age's own field comparison treats March 1 as
-- the boundary (see its own comment), so setting eligible_on to
-- anything else (e.g. February 28) would let calculate_age still
-- report 17 on the very date this system claims the member became
-- re-screenable — precisely the inconsistency this correction removes.
-- A February 29 DOB's +18 target year can never itself be a leap year
-- (both years divisible by 4 would require their difference, 18, to
-- also be divisible by 4, which it is not), so the "else" branch below
-- is structurally unreachable for a genuine +18 computation — retained
-- anyway for defensiveness and symmetry with lib/age.ts's own
-- eligibleOnDate, which documents the same property.
create or replace function tempa_private.calculate_eligible_on(p_dob date)
returns date
language plpgsql
security invoker
set search_path to 'pg_catalog'
immutable
as $function$
declare
  v_target_year integer;
  v_target_is_leap boolean;
begin
  v_target_year := extract(year from p_dob)::int + 18;
  v_target_is_leap := (v_target_year % 4 = 0 and v_target_year % 100 <> 0) or v_target_year % 400 = 0;

  if extract(month from p_dob)::int = 2 and extract(day from p_dob)::int = 29 and not v_target_is_leap then
    return make_date(v_target_year, 3, 1);
  end if;

  return make_date(v_target_year, extract(month from p_dob)::int, extract(day from p_dob)::int);
end;
$function$;

revoke all on function tempa_private.calculate_eligible_on(date) from public, anon, authenticated;


-- ============================================================
-- 4. TEMPA_PRIVATE.DERIVE_AGE_RANGE — the one canonical bucket rule
-- ============================================================
-- Mirrors lib/age.ts's deriveAgeRangeBucket exactly (six buckets:
-- 18-24, 25-34, 35-44, 45-54, 55-64, 65+), fed by calculate_age above
-- (never Postgres's built-in age()) so a leap-day adult's bucket
-- follows the exact same February 29 convention as the adult-
-- eligibility check itself. Intentionally duplicated in SQL —
-- documented in both places — because a Postgres function cannot
-- import a TypeScript module, and this bucket MUST be computed
-- server-side so the browser can never lie by supplying an arbitrary
-- age_range that conflicts with the authoritative DOB.
create or replace function tempa_private.derive_age_range(p_dob date)
returns text
language sql
security invoker
set search_path to 'pg_catalog'
stable
as $$
  select case
    when p_dob is null then null
    else (
      select case
        when a.age < 25 then '18-24'
        when a.age < 35 then '25-34'
        when a.age < 45 then '35-44'
        when a.age < 55 then '45-54'
        when a.age < 65 then '55-64'
        else '65+'
      end
      from (select tempa_private.calculate_age(p_dob, current_date) as age) a
    )
  end
$$;

revoke all on function tempa_private.derive_age_range(date) from public, anon, authenticated;


-- ============================================================
-- 5. SUBMIT_DOB_ELIGIBILITY — sole write path for account_eligibility
-- ============================================================
create or replace function public.submit_dob_eligibility(
  p_year integer,
  p_month integer,
  p_day integer
)
returns table(status text, eligible_on date)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_dob date;
  v_existing record;
  v_age integer;
  v_eligible_on date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- CONCURRENCY FIX (independent audit correction): a transaction-
  -- scoped advisory lock, keyed deterministically from auth.uid() only
  -- (never a client-supplied identifier), serializes concurrent calls
  -- for the SAME account BEFORE account_eligibility is even read. This
  -- closes a race the row-level `FOR UPDATE` below cannot close on its
  -- own: on a genuinely FIRST submission (no row exists yet), `FOR
  -- UPDATE` has no row to lock, so two concurrent first calls could
  -- both observe "no existing row," independently evaluate different
  -- submitted DOBs, and race into the later UPSERT — the later write
  -- silently replacing the first decision. hashtextextended produces a
  -- 64-bit hash of the account's own uuid text, giving an (extremely
  -- low collision probability) per-account lock key — two DIFFERENT
  -- accounts essentially never serialize against each other, only two
  -- calls for the SAME account do. pg_advisory_xact_lock is
  -- TRANSACTION-scoped: it releases automatically at this function's
  -- own implicit transaction commit OR rollback (including an early
  -- RAISE EXCEPTION anywhere below) — no explicit unlock call exists or
  -- is needed. The existing row-level FOR UPDATE below is kept as
  -- defense in depth for the case where a row already exists.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select * into v_existing
  from public.account_eligibility
  where user_id = auth.uid()
  for update;

  -- DOB IMMUTABILITY (independent audit correction): once this account
  -- is already `eligible` with a confirmed DOB, the submitted
  -- year/month/day is never evaluated at all — the existing decision
  -- is simply returned unchanged. Checked BEFORE any input validation
  -- below, deliberately: an already-eligible account gets no signal
  -- whatsoever about whether its (ignored) submission would otherwise
  -- have been a valid date. Never returns date_of_birth — only status
  -- and eligible_on, matching this function's own return signature.
  if found and v_existing.status = 'eligible' then
    return query select v_existing.status, v_existing.eligible_on;
    return;
  end if;

  -- A persisted ineligible decision, still inside its blocked window,
  -- is likewise NOT reopened by a fresh submission — returns the
  -- EXISTING decision unchanged, without evaluating or accepting the
  -- new DOB at all. This is what prevents "wrong answer, try again"
  -- DOB retries (see this migration's own header).
  if found and v_existing.status = 'ineligible' and current_date < v_existing.eligible_on then
    return query select v_existing.status, v_existing.eligible_on;
    return;
  end if;

  if p_year is null or p_month is null or p_day is null then
    raise exception 'Enter a valid date.';
  end if;

  -- make_date raises its own error (invalid_datetime_format /
  -- 22008-class) for an impossible calendar date (e.g. Feb 30, month
  -- 13) — caught and re-raised as the same restrained, non-teaching
  -- message every other validation failure below uses. Never reveals
  -- WHY a date was rejected beyond "enter a valid date."
  begin
    v_dob := make_date(p_year, p_month, p_day);
  exception when others then
    raise exception 'Enter a valid date.';
  end;

  if v_dob > current_date then
    raise exception 'Enter a valid date.';
  end if;

  -- A restrained upper bound on plausible age — catches an obvious
  -- fat-fingered year without asserting anyone could not possibly be
  -- this old. Mirrors lib/age.ts's MAX_REASONABLE_AGE constant (120).
  if tempa_private.calculate_age(v_dob, current_date) > 120 then
    raise exception 'Enter a valid date.';
  end if;

  v_age := tempa_private.calculate_age(v_dob, current_date);

  if v_age >= 18 then
    insert into public.account_eligibility (user_id, date_of_birth, status, eligible_on, checked_at, updated_at)
    values (auth.uid(), v_dob, 'eligible', null, now(), now())
    on conflict (user_id) do update
      set date_of_birth = excluded.date_of_birth,
          status = 'eligible',
          eligible_on = null,
          checked_at = now(),
          updated_at = now();

    -- An existing profile (grandfathered member re-screened, or a
    -- member re-confirming after an eligible_on window) gets its
    -- derived compatibility bucket synchronized from the newly-
    -- confirmed authoritative DOB — never left stale, and never
    -- independently settable by the client. A brand-new account with
    -- no profile row yet is a no-op UPDATE (matches zero rows); its
    -- age_range is populated instead by the profiles_enforce_adult_
    -- eligibility trigger the moment that profile is first inserted.
    update public.profiles
    set age_range = tempa_private.derive_age_range(v_dob)
    where id = auth.uid();

    return query select 'eligible'::text, null::date;
  else
    v_eligible_on := tempa_private.calculate_eligible_on(v_dob);

    -- The submitted DOB is deliberately NOT retained here — see this
    -- migration's own header, "UNDER-18 HANDLING AND PRIVACY WORDING."
    insert into public.account_eligibility (user_id, date_of_birth, status, eligible_on, checked_at, updated_at)
    values (auth.uid(), null, 'ineligible', v_eligible_on, now(), now())
    on conflict (user_id) do update
      set date_of_birth = null,
          status = 'ineligible',
          eligible_on = excluded.eligible_on,
          checked_at = now(),
          updated_at = now();

    return query select 'ineligible'::text, v_eligible_on;
  end if;
end;
$function$;

revoke all on function public.submit_dob_eligibility(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_dob_eligibility(integer, integer, integer) to authenticated;


-- ============================================================
-- 6. ACCEPT_CURRENT_LEGAL_DOCUMENTS — sole write path for legal_acceptances
-- ============================================================
-- SERVER-AUTHORITATIVE VERSIONS (independent audit correction): this
-- RPC previously took p_terms_version/p_community_guidelines_version
-- as CLIENT-SUPPLIED text arguments. A modified authenticated client
-- could submit a guessed FUTURE version string before that document
-- version existed; if lib/legal.ts later adopted that exact string,
-- the old (never-genuinely-reviewed) row would silently satisfy
-- isLegalCurrent() without the member ever having accepted that
-- document version. Fixed: this function now takes NO version
-- parameters at all. The two CONSTANT values below are the sole
-- authoritative source of "which version is currently being accepted"
-- — an authenticated caller cannot choose, override, or influence
-- them. They MUST exactly match lib/legal.ts's CURRENT_TERMS_VERSION /
-- CURRENT_COMMUNITY_GUIDELINES_VERSION — proven by a source-level
-- regression test (lib/__tests__/adultEligibilityMigration.test.ts)
-- that imports the actual TypeScript constants and compares them
-- against these literal SQL values. A future legal-document version
-- bump therefore requires updating BOTH lib/legal.ts AND this
-- function (via a new migration) — updating lib/legal.ts alone is NOT
-- sufficient, unlike what this file previously (incorrectly) implied.
-- WHO accepted remains fully server-authoritative via auth.uid() only
-- (unchanged); WHICH version gets recorded is now ALSO fully
-- server-authoritative, closing the gap the previous design left open.
--
-- LEGACY OVERLOAD CLEANUP (independent audit correction): PostgreSQL
-- functions are overloaded by signature — CREATE OR REPLACE FUNCTION
-- public.accept_current_legal_documents() creates/replaces ONLY the
-- zero-argument overload; it does NOT remove a previously existing
-- public.accept_current_legal_documents(text, text) if an earlier
-- draft of this migration (with the client-supplied-version
-- signature) was ever applied to a database, e.g. a staging/dev
-- environment. Left in place, that legacy overload would still be
-- directly callable with attacker-chosen version strings — silently
-- reopening the exact hole "SERVER-AUTHORITATIVE VERSIONS" above just
-- fixed. Dropped explicitly, by its own exact signature only (never a
-- bare DROP FUNCTION public.accept_current_legal_documents, which
-- would be ambiguous across overloads and could error or drop the
-- wrong one) — harmless on the intended fresh production state (no
-- prior draft ever applied there, so nothing to drop) and protective
-- everywhere else.
drop function if exists public.accept_current_legal_documents(text, text);

create or replace function public.accept_current_legal_documents()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_terms_version constant text := '2026-09-launch-v1';
  v_community_guidelines_version constant text := '2026-09-launch-v1';
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- Matches every other write RPC's own account-status gate
  -- (create_reply, keep_mind, set_dispatch_worth_reading, ...).
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select status into v_status
  from public.account_eligibility
  where user_id = auth.uid();

  if v_status is distinct from 'eligible' then
    raise exception 'Adult eligibility must be confirmed before accepting these documents.';
  end if;

  insert into public.legal_acceptances (user_id, document_type, document_version, accepted_at)
  values
    (auth.uid(), 'terms_of_service', v_terms_version, now()),
    (auth.uid(), 'community_guidelines', v_community_guidelines_version, now())
  on conflict (user_id, document_type, document_version) do nothing;
end;
$function$;

revoke all on function public.accept_current_legal_documents() from public, anon, authenticated;
grant execute on function public.accept_current_legal_documents() to authenticated;


-- ============================================================
-- 7. PROFILES_ENFORCE_ADULT_ELIGIBILITY — defense in depth
-- ============================================================
-- Same trigger SHAPE as this table's own existing
-- profiles_force_initial_mark_stage (docs/sql/2026-09-29-your-mark-
-- production.sql) — BEFORE INSERT, fixed search_path — but SECURITY
-- DEFINER, not SECURITY INVOKER: see this migration's own "TRIGGER
-- PRIVILEGE CORRECTION" header note for why. Because it now runs with
-- elevated privileges, it independently re-asserts new.id = auth.uid()
-- rather than merely assuming profiles' own (untracked-by-this-repo)
-- INSERT policy already guarantees that. A profile can never be
-- created for an account that is not currently `eligible`, regardless
-- of what the client attempts directly against the table — this does
-- not replace /begin's own UI gate, it backstops it. age_range is
-- force-overwritten from the authoritative DOB every time, exactly
-- like onboarding_stage/mark_id are force-overwritten by the existing
-- sibling trigger — whatever (if anything) the client supplied for
-- age_range is ignored.
create or replace function tempa_private.enforce_profile_adult_eligibility()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_dob date;
begin
  -- Explicit ownership backstop (independent audit correction): this
  -- trigger runs SECURITY DEFINER, so it must not simply trust that
  -- profiles' own INSERT policy already guarantees new.id = auth.uid()
  -- — re-asserted here independently, regardless of what that
  -- (untracked-by-this-repo) policy actually says.
  if new.id is distinct from auth.uid() then
    raise exception 'A profile can only be created for the authenticated account.';
  end if;

  select status, date_of_birth into v_status, v_dob
  from public.account_eligibility
  where user_id = new.id;

  if v_status is distinct from 'eligible' then
    raise exception 'A Tempa profile requires confirmed adult eligibility.';
  end if;

  new.age_range := tempa_private.derive_age_range(v_dob);
  return new;
end;
$function$;

revoke all on function tempa_private.enforce_profile_adult_eligibility()
  from public, anon, authenticated;

create trigger profiles_enforce_adult_eligibility
before insert on public.profiles
for each row execute function tempa_private.enforce_profile_adult_eligibility();

commit;

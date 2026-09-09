-- Tempa — Mail Call / Delayed Delivery, Migration 3 of N: the isolated
-- compute_deliver_at function only.
-- PREPARED 2026-09-04. NOT EXECUTED — review, then run in the Supabase
-- SQL editor. Migration 1 (letters.deliver_at) and Migration 2
-- (profiles.country_code + country_continent) are both live and
-- verified.
--
-- Scope, deliberately narrow: this migration adds ONE new function and
-- its privileges. It does NOT modify send_first_letter, reply_to_letter,
-- write_letter, letters_for_participant, any RLS policy, historical
-- letters, or any application code. compute_deliver_at is not called
-- from anywhere yet — wiring it into the writer RPCs (plus the
-- same-direction epsilon clamp, which needs correspondence-scoped
-- letter history this function deliberately doesn't touch) is a later,
-- separate migration.
--
-- ============================================================
-- RULES IMPLEMENTED — all already decided, none invented here
-- ============================================================
--
-- NOMINAL bands (TEMPA-DELAYED-DELIVERY-SPEC.md §8, "very distant"
-- collapsed into intercontinental per this session's approved
-- correction pass). These are DESIGN ANCHORS, not the function's actual
-- output range — see "NOMINAL BAND vs. ACTUAL OUTPUT RANGE" below for
-- what compute_deliver_at actually returns:
--   same country + same region              -> nominal 2-4 hours
--   same country + different/empty region   -> nominal 6-10 hours
--   same continent, different country       -> nominal 12-18 hours
--   different continent OR unknown geography-> nominal 20-28 hours
--
-- Band input is country_code/region only — never coordinates (spec
-- §8/T14, unchanged).
--
-- Jitter: deterministic, seeded from a uuid the CALLER generates and
-- passes in (never generated inside this function) — the correction-
-- pass rationale is that the caller (a future writer RPC) will use that
-- same uuid as the new letter's own row id, so seed and id are one
-- value, generated once, before either the delay calculation or the
-- INSERT happens. hashtext() reused deliberately, matching the existing
-- pattern in get_post_closure_recommendations
-- (docs/sql/2026-08-30-letters.sql) — approved in review pass §9 on the
-- basis that only within-this-letter repeatability is required, not
-- cross-version stability, so no cryptographic digest is warranted.
--
-- ============================================================
-- NOMINAL BAND vs. ACTUAL OUTPUT RANGE — read before trusting any
-- comment elsewhere in this file that mentions a band's hours
-- ============================================================
--
-- The formula is: take the NOMINAL band's MIDPOINT, then apply
-- deterministic jitter of +/-12.5% OF THE NOMINAL BAND'S WIDTH around
-- that midpoint. This is NOT "uniformly pick anywhere across the
-- nominal band" — the actual reachable output is a narrower window
-- centered on the midpoint. Exact effective ranges, per nominal band:
--
--   nominal 2-4h   (width 2h, midpoint 3h)  -> effective 2h45m-3h15m
--   nominal 6-10h  (width 4h, midpoint 8h)  -> effective 7h30m-8h30m
--   nominal 12-18h (width 6h, midpoint 15h) -> effective 14h15m-15h45m
--   nominal 20-28h (width 8h, midpoint 24h) -> effective 23h-25h
--     (this last effective range applies to BOTH the different-
--     continent band AND the unknown-geography fallback, since both
--     share the same 20-28h nominal band)
--
-- Every in-body comment below and every verification query in this
-- file states the EFFECTIVE range, not the nominal one, for exactly
-- this reason.
--
-- Null/unknown country_code on EITHER side -> different-continent
-- nominal band (effective 23h-25h, per the table above), never a
-- partial guess. This is a Tempa product decision made in this
-- session's correction/review passes (approved explicitly), not
-- something the original external spec states — it predates
-- country_code existing at all.
--
-- NOT implemented here, by design: the same-direction ordering clamp
-- (deliver_at(new) >= previous_same_direction_deliver_at + 1 minute).
-- That needs correspondence_id and per-direction letter history — a
-- concern of the WRITER RPCs, not of this pure geography calculation.
-- Applying it is part of the later migration that wires this function
-- in.
--
-- ============================================================
-- SECURITY MODEL
-- ============================================================
--
-- SECURITY DEFINER, required (not just preferable): country_continent
-- has zero grants to anon/authenticated (Migration 2), and every
-- observed profiles access pattern in this codebase is consistent with
-- RLS scoped to "own row only" — a non-definer caller almost certainly
-- could not read the OTHER participant's country_code at all. (No
-- CREATE TABLE profiles migration exists in this repo to cite the exact
-- policy directly; this is a strong inference from consistent patterns
-- elsewhere, stated as such, not asserted as fact. SECURITY DEFINER is
-- correct either way.)
--
-- search_path fixed to 'pg_catalog' only (not 'public') — matching
-- search_letterbox's convention, the more current/locked-down pattern
-- in this codebase, not the older 'public' convention send_first_letter
-- etc. still use. Every Tempa object below is explicitly public.*
-- qualified.
--
-- No EXECUTE grant to authenticated/anon/public at all. This function
-- is only ever meant to be called from INSIDE another SECURITY DEFINER
-- function (a future updated writer RPC) — such a call executes as that
-- calling function's OWNER, not the original client role, so no grant
-- here is needed for that to work, as long as both functions share an
-- owner (they will, same migration-running role). Revoking client
-- EXECUTE entirely is the narrowest correct grant.
--
-- Extra, cheap defense-in-depth on top of the grant revocation: the
-- function itself requires auth.uid() to be one of the two supplied
-- participants. Costs nothing for legitimate use (the real caller's
-- auth.uid() is always the sender or the replier) and means even a
-- future accidental grant widening couldn't be used to probe arbitrary
-- pairs' band classifications.
--
-- STABLE, not IMMUTABLE or VOLATILE: it reads table data (profiles,
-- country_continent) and calls now() (itself STABLE — constant within
-- one transaction), and writes nothing.
--
-- Time origin: now() only, no p_created_at parameter. now() is
-- transaction-stable in Postgres (same value everywhere it's evaluated
-- within one transaction) — since this function will be called from
-- inside a writer RPC's transaction, in the same transaction as the new
-- letter's own INSERT (whose created_at also resolves via now()), this
-- guarantees deliver_at is computed from the exact same instant as
-- created_at, no drift, no need to thread a timestamp through as a
-- parameter, and never a client-suppliable value. (clock_timestamp()
-- would NOT have this property and is deliberately not used.)
--
-- timestamptz already stores an absolute UTC instant — no timezone/DST
-- ambiguity in storage; this function never touches display formatting.

begin;

create or replace function public.compute_deliver_at(
  p_sender_id uuid,
  p_recipient_id uuid,
  p_seed uuid
)
returns timestamptz
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$

declare
  v_sender_region text;
  v_recipient_region text;
  v_sender_country_code text;
  v_recipient_country_code text;
  v_sender_continent text;
  v_recipient_continent text;
  v_band_min interval;
  v_band_max interval;
  v_unit double precision;
  v_base interval;
  v_jitter interval;

begin

  if auth.uid() is null or auth.uid() not in (p_sender_id, p_recipient_id) then
    raise exception 'Not authorized to compute delivery for this pair.';
  end if;


  select region, country_code
  into v_sender_region, v_sender_country_code
  from public.profiles
  where id = p_sender_id;

  select region, country_code
  into v_recipient_region, v_recipient_country_code
  from public.profiles
  where id = p_recipient_id;


  if v_sender_country_code is null or v_recipient_country_code is null then

    -- Unknown geography on either side: farthest band, never guessed.
    v_band_min := interval '20 hours';
    v_band_max := interval '28 hours';

  else

    select continent into v_sender_continent
    from public.country_continent
    where country_code = v_sender_country_code;

    select continent into v_recipient_continent
    from public.country_continent
    where country_code = v_recipient_country_code;

    if
      v_sender_country_code = v_recipient_country_code
      and v_sender_region is not null
      and v_sender_region = v_recipient_region
    then

      -- Same country, same non-null region. Nominal band 2-4h;
      -- v_band_min/v_band_max below are DESIGN ANCHORS used only to
      -- derive a midpoint and a jitter width, not the function's actual
      -- output range — see the NOMINAL BAND vs. ACTUAL OUTPUT RANGE
      -- note in the header. Effective output: 2h45m-3h15m.
      v_band_min := interval '2 hours';
      v_band_max := interval '4 hours';

    elsif v_sender_country_code = v_recipient_country_code then

      -- Same country, different or empty region. Nominal band 6-10h;
      -- effective output: 7h30m-8h30m.
      v_band_min := interval '6 hours';
      v_band_max := interval '10 hours';

    elsif v_sender_continent = v_recipient_continent then

      -- Different country, same continent. Nominal band 12-18h;
      -- effective output: 14h15m-15h45m.
      v_band_min := interval '12 hours';
      v_band_max := interval '18 hours';

    else

      -- Different continents ("very distant" collapsed in here per the
      -- approved V1 scope — see header). Nominal band 20-28h; effective
      -- output: 23h-25h.
      v_band_min := interval '20 hours';
      v_band_max := interval '28 hours';

    end if;

  end if;


  -- Deterministic jitter from the caller-supplied seed — see header for
  -- why the seed is a parameter, not generated here. Same pattern as
  -- get_post_closure_recommendations's hashtext(...) & 2147483647.
  v_unit := ((hashtext(p_seed::text) & 2147483647)::bigint + 1)::double precision / 2147483648.0;

  -- v_base is the nominal band's MIDPOINT, not a lower bound. v_jitter
  -- is +/-12.5% of the nominal band's WIDTH, applied around that
  -- midpoint — so the final return value only ever reaches a narrower
  -- window centered on the midpoint, never the nominal band's own min
  -- or max edges. See the NOMINAL BAND vs. ACTUAL OUTPUT RANGE note in
  -- the header for the exact effective range this produces per band.
  v_base := v_band_min + (v_band_max - v_band_min) / 2;
  v_jitter := (v_band_max - v_band_min) * 0.125 * (v_unit * 2 - 1);


  return now() + v_base + v_jitter;

end;
$function$;


revoke all
on function public.compute_deliver_at(uuid, uuid, uuid)
from public, anon, authenticated;


commit;


-- ============================================================
-- VERIFY (optional — read-only except where noted, run AFTER the
-- transaction above has committed)
--
-- IMPORTANT LIMITATION, stated plainly: this environment has no
-- service-role key or database CLI (see Migration 2's own header for
-- the same limitation) — I cannot look up real profile ids myself.
-- Query 0 below finds usable real id pairs from your actual data; the
-- scenario queries after it are templates for you to fill in with those
-- ids using the auth-impersonation pattern already established this
-- session (set_config('request.jwt.claims', ...) + set local role
-- authenticated).
--
-- Every geography scenario below tests the EFFECTIVE output range
-- mechanically (compute_deliver_at(...) - now() as delay, plus a
-- within_expected_range boolean) rather than only asserting it in a
-- comment — see the header's "NOMINAL BAND vs. ACTUAL OUTPUT RANGE"
-- note for why these ranges are narrower than the nominal 2-4h/6-10h/
-- 12-18h/20-28h bands. Each scenario calls the function exactly ONCE,
-- inside a CTE, so "delay" and "within_expected_range" always describe
-- the SAME invocation rather than two independently-seeded calls.
-- ============================================================

-- 0. Find candidate pairs for each scenario from real data — grouped by
--    country_code and continent so you can pick concrete ids for the
--    scenario queries below.
select id, country, region, country_code
from public.profiles
order by country_code nulls last, region nulls last;

select p.id, p.country, p.country_code, cc.continent
from public.profiles p
left join public.country_continent cc on cc.country_code = p.country_code
order by cc.continent nulls last, p.country_code;

-- ------------------------------------------------------------
-- Auth impersonation, same pattern as earlier this session's search
-- RPC verification — replace <sender-uuid> with a real profile id you
-- want to call AS (auth.uid() must equal sender or recipient).
-- ------------------------------------------------------------
-- select set_config('request.jwt.claims', json_build_object('sub','<sender-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. Same country, same region (use two ids from query 0 sharing both
--    country_code and a non-null region). Effective range: 2h45m-3h15m.
-- with call as (
--   select compute_deliver_at('<sender-uuid>', '<recipient-uuid>', gen_random_uuid()) as deliver_at
-- )
-- select
--   deliver_at,
--   deliver_at - now() as delay,
--   (deliver_at - now()) between interval '2 hours 45 minutes' and interval '3 hours 15 minutes' as within_expected_range
-- from call;

-- 2. Same country, different/empty region. Effective range: 7h30m-8h30m.
-- with call as (
--   select compute_deliver_at('<sender-uuid>', '<recipient-uuid>', gen_random_uuid()) as deliver_at
-- )
-- select
--   deliver_at,
--   deliver_at - now() as delay,
--   (deliver_at - now()) between interval '7 hours 30 minutes' and interval '8 hours 30 minutes' as within_expected_range
-- from call;

-- 3. Same continent, different country. Effective range: 14h15m-15h45m.
-- with call as (
--   select compute_deliver_at('<sender-uuid>', '<recipient-uuid>', gen_random_uuid()) as deliver_at
-- )
-- select
--   deliver_at,
--   deliver_at - now() as delay,
--   (deliver_at - now()) between interval '14 hours 15 minutes' and interval '15 hours 45 minutes' as within_expected_range
-- from call;

-- 4. Different continents. Effective range: 23h-25h.
-- with call as (
--   select compute_deliver_at('<sender-uuid>', '<recipient-uuid>', gen_random_uuid()) as deliver_at
-- )
-- select
--   deliver_at,
--   deliver_at - now() as delay,
--   (deliver_at - now()) between interval '23 hours' and interval '25 hours' as within_expected_range
-- from call;

-- 5. Unknown geography — no currently-live profile has a null
--    country_code (Migration 2 resolved all 5). To exercise this path
--    you would need to either (a) use a disposable/test account whose
--    country_code you don't mind temporarily setting to null and
--    restoring afterward, or (b) wait for a real signup created before
--    profile-form.tsx is updated to populate country_code (the
--    transition window Migration 2's header describes). Not something
--    to do against real user data casually — flagging rather than
--    scripting it. If you do test it manually, same effective range as
--    scenario 4 (23h-25h), since unknown geography shares its nominal
--    band:
--      update public.profiles set country_code = null where id = '<test-id>';
--      with call as (
--        select compute_deliver_at('<sender-uuid>', '<recipient-uuid>', gen_random_uuid()) as deliver_at
--      )
--      select deliver_at, deliver_at - now() as delay,
--        (deliver_at - now()) between interval '23 hours' and interval '25 hours' as within_expected_range
--      from call;
--      update public.profiles set country_code = '<original-code>' where id = '<test-id>';

-- 6. Sender/recipient reversal — same seed, swapped roles, both calls
--    in ONE statement so there's no risk of the two evaluations landing
--    in different transactions/now() instants. Expect forward = reversed.
-- with calls as (
--   select
--     compute_deliver_at('<id-a>', '<id-b>', '11111111-1111-1111-1111-111111111111') as forward,
--     compute_deliver_at('<id-b>', '<id-a>', '11111111-1111-1111-1111-111111111111') as reversed
-- )
-- select forward, reversed, forward = reversed as symmetric
-- from calls;

-- 7. Unauthorized call — impersonate someone who is NEITHER sender nor
--    recipient, expect an exception ("Not authorized...").
-- select set_config('request.jwt.claims', json_build_object('sub','<some-other-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select compute_deliver_at('<id-a>', '<id-b>', gen_random_uuid());

-- 8. Direct-call-without-grant — as authenticated with NO prior
--    impersonation setup (or as anon), expect a permission-denied error
--    at the EXECUTE-privilege level, before the function body even
--    runs. Easiest to confirm via the same grant-introspection shape
--    used for country_continent in Migration 2:
select exists (
  select 1 from information_schema.role_routine_grants
  where routine_schema = 'public' and routine_name = 'compute_deliver_at'
    and grantee = 'authenticated' and privilege_type = 'EXECUTE'
) as authenticated_can_execute;
-- Expect: false.

select exists (
  select 1 from information_schema.role_routine_grants
  where routine_schema = 'public' and routine_name = 'compute_deliver_at'
    and grantee = 'anon' and privilege_type = 'EXECUTE'
) as anon_can_execute;
-- Expect: false.

select prosecdef, proconfig, provolatile
from pg_proc
where proname = 'compute_deliver_at';
-- Expect: prosecdef = true, proconfig contains search_path=pg_catalog,
-- provolatile = 's' (STABLE).

-- 9. Repeat invocation, same seed — determinism check. Both calls in
--    ONE statement, so Postgres's transaction/statement-stable now()
--    cannot confuse the result the way two separate top-level
--    statements could. Expect call_1 = call_2 and calls_match = true.
-- with calls as (
--   select
--     compute_deliver_at('<sender-uuid>', '<recipient-uuid>', '22222222-2222-2222-2222-222222222222') as call_1,
--     compute_deliver_at('<sender-uuid>', '<recipient-uuid>', '22222222-2222-2222-2222-222222222222') as call_2
-- )
-- select call_1, call_2, call_1 = call_2 as calls_match
-- from calls;

-- 10. Different seeds, same pair, same statement — expect DIFFERENT
--     output (jitter actually varies), both still inside that pair's
--     effective range (substitute the correct interval bounds for
--     whichever scenario this pair falls into, per items 1-4 above).
-- with calls as (
--   select
--     compute_deliver_at('<sender-uuid>', '<recipient-uuid>', '33333333-3333-3333-3333-333333333333') as seed_a,
--     compute_deliver_at('<sender-uuid>', '<recipient-uuid>', '44444444-4444-4444-4444-444444444444') as seed_b
-- )
-- select
--   seed_a, seed_b, seed_a <> seed_b as differs,
--   seed_a - now() as delay_a, seed_b - now() as delay_b
-- from calls;

-- 11. Anonymous/no-auth invocation — distinct from test 7's "wrong
--     participant" case. Two variants:
--     (a) as the anon role directly — blocked by the REVOKE itself,
--         never reaches the function body:
-- set local role anon;
-- select compute_deliver_at('<id-a>', '<id-b>', gen_random_uuid());
-- Expect: permission denied for function compute_deliver_at.
--     (b) as authenticated but with no JWT claims configured at all
--         (auth.uid() resolves to null) — reaches the body, hits the
--         explicit guard:
-- reset role;
-- set local role authenticated;
-- select compute_deliver_at('<id-a>', '<id-b>', gen_random_uuid());
-- Expect: "Not authorized to compute delivery for this pair." (from
-- the auth.uid() is null branch specifically).

-- 12. Volatility/metadata of the DEPENDENCIES, not just this function —
--     confirms the classifications in this checkpoint's report directly
--     from your live catalog rather than from memory.
select proname, provolatile
from pg_proc
where proname = 'hashtext' and pronamespace = 'pg_catalog'::regnamespace;
-- Expect: provolatile = 'i' (IMMUTABLE).

select proname, provolatile
from pg_proc
where proname = 'uid' and pronamespace = 'auth'::regnamespace;
-- Expect: provolatile = 's' (STABLE).

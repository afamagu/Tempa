# Adult Eligibility + Legal Acceptance Gate

Technical operating documentation for the account-entry gate added on
branch `chatgpt-adult-eligibility-legal-gate-2026-09-21`. Not a legal
document; describes how the system is wired.

## Architecture

A new account-entry layer sits ABOVE the existing profile-onboarding
resolver, which is untouched:

```
lib/onboarding.ts        resolveOnboardingDestination()   — profile stage only, unchanged
lib/account-entry.ts      resolveAccountEntryDestination()  — NEW, layered above it
```

`resolveAccountEntryDestination` checks (in order): authenticated? →
eligibility status? → legal acceptance current? → then delegates to
`resolveOnboardingDestination` for the existing `mark | question |
complete` sequence. `profiles.onboarding_stage` never gained a new
value (`legal`, `age`, etc.) — eligibility/legal state lives entirely
in its own tables.

Three call sites read the actual state and hand it to the pure
resolver (same "query inline, share only the pure decision" pattern
this codebase already used for `resolveOnboardingDestination`):
`proxy.ts`, `app/auth/callback/route.ts`, `app/begin/page.tsx`.

## Eligibility table — `account_eligibility`

One row per account (`user_id` primary key). `status` is one of
`eligible | ineligible | review_required` (only the first two are ever
written by `submit_dob_eligibility` today; `review_required` is
schema-level scaffolding for a future manual-review path).

- **Eligible**: `date_of_birth` is retained (deliberate — see below),
  `eligible_on` is null.
- **Ineligible**: `date_of_birth` is `null` (never retained), only
  `eligible_on` (date_of_birth + 18 years) survives, so the account can
  be screened again once that date arrives without permanently keeping
  a minor's exact birth date.

RLS: `select` own row only. No insert/update/delete grant to anyone —
`submit_dob_eligibility` (`SECURITY DEFINER`) is the sole write path.

## Legal acceptance table — `legal_acceptances`

One row per `(user_id, document_type, document_version)` accepted,
unique on that triple. `document_type` is `terms_of_service` or
`community_guidelines`. Never a boolean flag, never localStorage, never
auth metadata. RLS/grants mirror `account_eligibility`.
`accept_current_legal_documents` (`SECURITY DEFINER`) is the sole write
path, and requires `account_eligibility.status = 'eligible'` first.

## Required version constants — `lib/legal.ts`

```ts
export const CURRENT_TERMS_VERSION = '2026-09-launch-v1'
export const CURRENT_COMMUNITY_GUIDELINES_VERSION = '2026-09-launch-v1'
```

**To require reacceptance of a new legal version**: bump the relevant
constant here. Nothing else changes — `isLegalCurrent()` will then
treat every existing acceptance of the old version as stale, and
`resolveAccountEntryDestination` will route the affected members back
to `/begin`'s legal-acceptance state (never DOB, never profile
onboarding — those stay untouched) the next time they hit a protected
route or auth callback.

## Under-18 handling

Age is computed server-side via `tempa_private.calculate_age` —
**deliberately not Postgres's built-in `age()`** (independent audit
correction; see "February 29 convention" below) — calendar-correct,
never `18 * 365`. Under 18 → `status = 'ineligible'`, DOB not retained,
`eligible_on` computed. A resubmission while `current_date <
eligible_on` is a no-op: the function returns the existing persisted
decision without evaluating the new DOB at all — this is what prevents
an immediate "wrong answer, try again" retry. `/begin`'s ineligible
terminal state has no retry/change-birthday affordance; the only action
performs a real sign-out (not just a link) before landing on sign-in.

**Privacy wording correction (independent audit finding):** do not
describe this design as Tempa "no longer retaining the person's exact
birth-date information." `eligible_on` is retained, and it is derived
directly from the submitted DOB — not an unrelated or irreversible
value; it could generally be used to infer the underlying birth date
(within the ambiguity the February 29 special case introduces). What
this design actually achieves: the raw *submitted* value is not stored
verbatim in the ordinary `date_of_birth` field once ineligible, and
only the minimum derived value needed to enforce the gate is kept. The
future Privacy Notice must describe `eligible_on` as retained, derived,
private account data — not as evidence Tempa discards a minor's
birth-date information (see "What still needs to happen," below).

## Eligible DOB immutability (independent audit correction)

Once an account is `status = 'eligible'` with a confirmed DOB,
`submit_dob_eligibility` never evaluates a further submission at all —
checked *before* any input validation, so an already-eligible account
gets no signal about whether an ignored resubmission would otherwise
have been valid. Previously, calling the RPC again with a different
adult DOB silently overwrote `date_of_birth` and the derived
`age_range` — client-spoofable authoritative age data after onboarding.
A deliberate future DOB-correction mechanism, if Tempa ever needs one,
must be its own separate, controlled flow — never a side effect of
resubmitting this RPC. The RPC's return signature (`status,
eligible_on`) never includes `date_of_birth` in any branch.

## February 29 convention (independent audit correction)

One Tempa-wide rule, enforced identically everywhere: **for a February
29 DOB, when the relevant anniversary year is not a leap year, March 1
is the birthday boundary — never February 28.**

This falls out of `calculateAge`/`tempa_private.calculate_age`'s own
plain field comparison (`today.day >= dob.day`) without any special
case: February 28 never satisfies `28 >= 29`, so the birthday has not
yet occurred; March 1 is the first date the comparison succeeds
(`today.month > dob.month`). `eligibleOnDate`/`tempa_private.
calculate_eligible_on` (the one place that DOES need an explicit
special case, since it computes a *future* date via addition rather
than comparison) resolve a Feb-29 DOB's +18 target year to March 1 for
exactly this reason — self-consistency: calling the age check on the
eligible-on date it produced is guaranteed to return exactly 18. A
previous version of `eligibleOnDate` resolved to February 28, which
disagreed with the age check on that same date (`calculateAge` still
returned 17) — fixed. SQL deliberately does not rely on Postgres's
built-in `age()` for this: `tempa_private.calculate_age` transliterates
the same TypeScript algorithm so SQL and TypeScript agree by
construction, not by assumption about `age()`'s own leap-day semantics
(which this migration has not been executed to verify empirically).

## DOB / age-range behavior

Exact DOB is private, in `account_eligibility.date_of_birth`, RLS-owned
to the account. It is never selected into any public-readable view,
RPC output, or Board/discovery/Dispatch payload — `app/begin/page.tsx`
itself only ever selects `status, eligible_on`, never `date_of_birth`.

`profiles.age_range` remains the six existing buckets
(18-24…65+) and is DERIVED, never client-supplied:
`tempa_private.derive_age_range(dob)` in SQL mirrors
`lib/age.ts`'s `deriveAgeRangeBucket` exactly (intentionally duplicated
— a Postgres function cannot import a TS module). It is populated by:

- `profiles_enforce_adult_eligibility` (`BEFORE INSERT` trigger on
  `profiles`, same shape as the existing
  `profiles_force_initial_mark_stage` trigger) — forcibly overwrites
  `age_range` from the account's confirmed DOB on every profile
  insert, and rejects the insert outright if the account is not
  currently `eligible`.
- `submit_dob_eligibility` itself — re-syncs an EXISTING profile's
  `age_range` whenever DOB is (re)confirmed.

`app/profile/profile-form.tsx` no longer asks for age range at all;
`AGE_RANGE_OPTIONS` in `app/profile/data.ts` is untouched and still
used by unrelated discovery-filter UI.

## Routing sequence

New member: `sign-in → /begin (DOB) → /begin (legal) → /profile →
/profile/mark → /profile/question → home`.

Existing member missing only the new gate: `protected route → /begin
(DOB, if no eligibility row yet) → /begin (legal, if not current) →
resume exact prior profile-onboarding stage or the original requested
destination`.

`next` is preserved end-to-end via `sanitizeInternalPath`, the same
helper `app/sign-in` and `app/auth/callback` already used — `/begin`
round-trips it through its own `?next=` param.

`/begin` is deliberately NOT in `proxy.ts`'s matcher — it performs its
own authenticated server-state check, avoiding any possibility of a
matcher-driven redirect loop. Public legal routes (`/terms`,
`/privacy`, `/community-guidelines`, `/safety`) are likewise never in
the matcher, so they stay reachable without any account-entry state.

## Security / privacy summary

- Every write RPC takes its identity from `auth.uid()` only — neither
  RPC accepts a `user_id`/`uuid` argument from the client.
- Both RLS policies are `auth.uid() = user_id` — no other authenticated
  account can read another's eligibility or legal-acceptance rows.
- `submit_dob_eligibility` and `accept_current_legal_documents` are
  both `SECURITY DEFINER` with `search_path` fixed to `pg_catalog`,
  matching this repo's established RPC-hardening posture.
- Defense in depth: `profiles_enforce_adult_eligibility` blocks profile
  creation at the database level even if a client bypassed `/begin`'s
  UI entirely.
- **Trigger privilege correction (independent audit correction):**
  `profiles_enforce_adult_eligibility` is `SECURITY DEFINER`, not
  `SECURITY INVOKER` — it must call `tempa_private.derive_age_range`,
  which is deliberately not directly `EXECUTE`-able by `authenticated`,
  and a new-profile `INSERT` is an ordinary authenticated statement
  (unlike the profile `UPDATE`s inside `submit_dob_eligibility`, which
  already ran `SECURITY DEFINER`). Because the trigger now runs with
  elevated privileges, it independently re-asserts `new.id =
  auth.uid()` as its own ownership backstop, rather than assuming
  `profiles`' own (not tracked by this repo's migration history)
  `INSERT` policy already guarantees that. `derive_age_range` itself
  keeps its narrow grant — the fix is entirely in the trigger's own
  security context, not a broader `tempa_private` exposure.

## What still needs to happen before production

- **SQL has NOT been executed.** `docs/sql/2026-09-21-adult-eligibility-and-legal-acceptance.sql`
  and its `-verify.sql` companion are prepared-only, and the verifier
  itself has not been run live (its text-matching checks may need the
  same whitespace-normalization follow-up this repo's other verifiers
  needed the first time they actually ran).
- `/terms`, `/privacy`, `/community-guidelines`, `/safety` do not yet
  exist as routes/content in this repository — `/begin` links to them
  by href, but they are dead links until published. **Do not launch
  with dead legal links.**
- Once the legal documents are finalized, confirm
  `CURRENT_TERMS_VERSION` / `CURRENT_COMMUNITY_GUIDELINES_VERSION` in
  `lib/legal.ts` match the frozen text before real member acceptance is
  collected.
- **The future Privacy Notice must describe `eligible_on` accurately**
  (independent audit finding — see "Under-18 handling," above): as
  retained, derived, private account data that could generally be used
  to infer a minor's birth date — not as evidence that Tempa discards
  that information.

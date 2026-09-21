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

`submit_dob_eligibility` computes age server-side via Postgres's
`age()` (calendar-correct, never `18 * 365`). Under 18 → `status =
'ineligible'`, DOB not retained, `eligible_on` computed. A resubmission
while `current_date < eligible_on` is a no-op: the function returns the
existing persisted decision without evaluating the new DOB at all —
this is what prevents an immediate "wrong answer, try again" retry.
`/begin`'s ineligible terminal state has no retry/change-birthday
affordance; the only action is "Return to sign in."

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

## What still needs to happen before production

- **SQL has NOT been executed.** `docs/sql/2026-09-21-adult-eligibility-and-legal-acceptance.sql`
  and its `-verify.sql` companion are prepared-only.
- `/terms`, `/privacy`, `/community-guidelines`, `/safety` do not yet
  exist as routes/content in this repository — `/begin` links to them
  by href, but they are dead links until published. **Do not launch
  with dead legal links.**
- Once the legal documents are finalized, confirm
  `CURRENT_TERMS_VERSION` / `CURRENT_COMMUNITY_GUIDELINES_VERSION` in
  `lib/legal.ts` match the frozen text before real member acceptance is
  collected.

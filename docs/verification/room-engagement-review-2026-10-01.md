# PR #54 review against main

Baseline: `8f07240253369a83e08600a236878f9e61188c3d` (PR #55 merged).

## Result

The reviewed change covers Home's Room conversation, fair discovery, live-Question administration, private member Question suggestions, and reserved house pseudonyms. Pen-pal @ invitations and invitation emails are not implemented by this PR.

- Reconciled profile creation with the language-first onboarding changes, retaining localized reserved-name feedback and rejecting late availability responses after a name becomes reserved.
- Fixed pagination against mutable fairness ranks. A database-issued browse timestamp excludes people served during that browse, then the next request takes the front of the remaining ranked pool. Filter changes restart the browse; exact Question focus is preserved. Legacy discovery retains its existing offset fallback.
- The ranking helper returns relative rank and only the caller's own encounter time, without global exposure counts or account creation dates.
- New member-facing Room, Home conversation and suggestion copy uses all four interface dictionaries. Member-authored questions and responses remain original writing.
- Serialized live-Question selections and retained the current visible Question when retiring extra legacy slots. Prompts, answers and the First Question remain intact.
- Suggestion submissions require an active account and profile, are limited to three per day, and remain private. Admin saves preserve existing published-Question links. Network errors recover without exposing database details.

## Validation

- Production build and TypeScript passed.
- Full suite: baseline 5,778 passed / 51 failed; reviewed branch 5,809 passed / 40 failed. Every remaining failure is also a baseline failure; no new failures. Eleven obsolete Home assertions were updated for the approved Home hierarchy.
- Three new suggestion interaction tests passed separately: incomplete question rejection, explicit credit submission/review confirmation, and recovery after a thrown network error.
- Changed-file lint reports seven errors in the pre-existing profile-form ref/effect code. The same seven errors exist on main; no new changed-file lint errors.
- PostgreSQL/PGlite fixtures execute the actual SQL migration and verification packs. Checks cover all thirteen eligible people across three browse pages, no refresh inflation of weekly exposure, admin authorization, First Question preservation, reserved names, daily suggestion cap, account-status refusal, hidden-answer/active-partner/contacted-answer exclusions and exact Question focus.
- Fixture checks do not replace execution against the production schema. Production SQL remains unexecuted at review time. Authenticated live UI behavior remains to be checked after deployment.

## Production prerequisite

Run the complete contents of:

1. `docs/sql/2026-10-01-room-engagement-production.sql`
2. `docs/sql/2026-10-01-room-engagement-production-verify.sql`

The first is one transaction containing the five reviewed migrations. Any error aborts the pack. It requires the already-applied editorial-byline foundation and refuses to rename ordinary members with reserved names. The second asserts required privileges and invariants, checks reserved names, and rolls back its exposure probes. Expected final result: `ROOM_ENGAGEMENT_VERIFIED`. The `live_room_question_selected` column reports whether an existing live Question is available; false requires an editorial selection in Admin after deployment.

## Reproduce SQL fixtures

The test harness uses an isolated PGlite dependency, not an application dependency:

```sh
npm install --prefix /tmp/tempa-room-sql @electric-sql/pglite
node docs/verification/room-engagement-sql-review.mjs /tmp/tempa-room-sql/node_modules/@electric-sql/pglite/dist/index.js
```

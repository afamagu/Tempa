# Recovered engagement release review

The supplied patch reproduces tree `c6bc4e5bbbcd6cea5c23253728b3625bfd2bd8bb`
on original PR #54 head `215cee5f9537d4c7689632b6c5d062b4843789e0`.
It was local-only and absent from the merged production release.

Reconciled against main `d0388686dfd4656a6bcc542619113f1854adcf05`, preserving
language-first onboarding, localized interface dictionaries, readonly answer
permission hints, current archive routes, fair-rank privacy and browse timestamps.
New profile discovery SQL now uses the deployed helper's `fair_rank` contract
instead of removed raw exposure fields. Invitation service guards reject null
roles and a sender-wide transaction lock protects the daily limit.

Restores Letters -> Pen Pals / Discover; bounded profile search and filters;
append-six Room browsing; shared correspondent picker; private Room invitations;
preferences, fenced/idempotent email jobs and worker with sending disabled.
Adds a finite horizontal six-profile suggestion row in Discover and a Home
people fallback when no current Room Question is selected. Sparse candidate
pools show only real eligible members.

Moment recovery is separately merged/deployed in PR #58. The prior durable-path
draft fix remains intact. This branch includes that same repair; it preserves
attachments after failed image loads and gives Dispatch restoration the existing
letter retry/backoff behavior. A production Storage cause is not claimed without
the affected member's image response or a live refresh check.

Validation: production build and TypeScript pass; 177 focused recovered/draft
tests passed, two actual Moment interaction tests passed, 47 navigation/question/
discovery tests passed, and 22 final Home/navigation/browser tests passed.
The initial full run had 5,824 passes and 39 failures versus main's 5,812 passes
and 40 failures. Its only new failure was the old Pen pals label assertion,
updated for the settled Letters label and then passing in focused checks.
All other failing test names existed on main. Relevant changed-file lint has
zero errors; native image warnings remain. SQL fixture tests exercise the actual
migrations: filtering, ranking, eligibility, RLS, forged IDs, invitation idempotency,
disabled delivery, fencing, frozen provider payload and expired retries.

The release also includes PR #57 and its 200,000-character Dispatch ceiling repair in the complete SQL pack.

Production database execution and authenticated UI checks are pending. Run the
complete `2026-10-01-engagement-production.sql` once after the already-applied
PR #54 SQL, followed by `2026-10-01-engagement-production-verify.sql`. Expected:
`ENGAGEMENT_RECONCILIATION_VERIFIED`, including `email_sending_disabled=true`.
Invitation emails remain disabled pending separate delivery validation; this
release must not enable them. No member email was sent during review.

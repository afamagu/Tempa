# Tempa PR #54: final engagement reconciliation

Prepared 1 October 2026. Production deployment and SQL have not been changed.

## Frozen behavior implemented

- Main navigation: Home → Letters → The Room → The Board → You, in all four interface dictionaries.
- Letters: Pen Pals is existing correspondence; Discover is separate profile-led discovery.
- Discover: visible pseudonym search and Country, Language, Age, Gender, Looking for and All filters. Choice panels use searchable buttons rather than native filter dropdowns. Filters reset results. Six compact profile cards per request.
- Home: What matters now, current Room Question with three real answers, What people are writing and existing announcement. The conversation stays below Arrivals; correspondent invitations sit with member notices/arrival activity.
- Room: one live Question, six compact answer previews without invented titles; Keep looking appends six and excludes identities already shown. Opening an answer preserves existing profile/first-letter paths. Shared fairness, deduplication, editorial bylines, Mark and writing-style data are retained.
- Shared correspondent picker: @ or a single * opens eligible established correspondents, strongest correspondence first, Mark plus pseudonym, filterable and keyboard-selectable. Integrated into first letters, first-contact replies, ongoing letters, Dispatches, comments, Room answers and postcard notes/reveal text. Insertion uses the owning state or Tiptap transaction and is independently undoable.
- General writing inserts the selected pseudonym as text. Room answers additionally retain selected identity IDs and create private invitations after successful safety-checked publishing. There are no Tempa-wide mentions, new follower mechanics or notification blasts from other writing surfaces.
- Room invitations: at most two recipients for an answer; existing recipients cannot be re-invited by edits/retries. The database checks ownership, visible published answer, selected name, live Question, active established correspondence, delivery, hidden correspondence, blocking, enforcement and account lifecycle. Sender/day limits add an abuse guard. Failed invitation recording never claims the answer failed to save; a retry is provided.
- Recipient Home notice and independent invitation-email preference in You → Notifications. Durable private email jobs, disabled sending by default, bounded claims, token fencing, retry eligibility checks, exact frozen provider payload, stable idempotency key and manual review past the provider window. The existing authenticated cron entry point runs invitation delivery after arrival delivery; a missing migration doesn't break arrival delivery.

## Local validation

- TypeScript: passes.
- Production `npm run build`: passes, including /letters/discover.
- ESLint on changed TypeScript/JavaScript: no errors; three pre-existing warnings in existing composer/postcard files.
- Full regression suite: 5,804 pass; 47 fail across 18 files. Untouched PR #54 merged with main had 5,790 pass and 52 fail. All 47 remaining failures existed in that baseline; no new failures. Five outdated discovery/back-navigation assertions were corrected. Nine new behavior tests pass.
- Isolated PostgreSQL/WASM migration checks: pass for filtering, eligibility/ranking, forged IDs, RLS/grants, event idempotency, disabled email claims, claim-token fencing, exact provider payload freezing and expired retry manual review. These fixtures stub existing Supabase auth/lifecycle primitives; they do not replace staged verification against the actual project.
- Whitespace check: passes.

## Review and release

This work includes main's merged language foundation (5ab5e521) and PR #54 head (215cee5f). PR #55 is not included. No Vercel request, branch push, merge, production migration or email send was performed.

A GitHub object upload was blocked by automatic approval review. This batch remains local and is supplied as a patch with a verification record; the remote PR head is unchanged.

Apply the combined patch only to a clean checkout at 215cee5f9537d4c7689632b6c5d062b4843789e0; it includes the language-foundation integration, so do not apply it on top of a separately merged/rebased copy of main without reviewing the conflicts. Run git apply --check before applying.

Before release: review the remaining pre-existing failures; validate against staging Supabase; run the pending reserved-name, current-Question, fair-exposure, set-based recorder and suggestions migrations in dependency order, then the two new 2026-10-01 migrations and their read-only verifier. Keep invitation email sending disabled until a consented staging send verifies From, scheduler and preferences. Run one consolidated Vercel preview when the quota allows, then inspect UI/authenticated routes before merging. No automatic production merge.

Optional local SQL checks: install @electric-sql/pglite into a temporary folder and set TEMPA_SQL_TEST_MODULE to its dist/index.js before running node scripts/check-engagement-sql.mjs. This script has no production database connection.

## Remaining baseline failures

- app/block-button.test.tsx > BlockButton call-site wiring — fullBlockRedirect > the public profile page passes fullBlockRedirect="/minds" (its own route becomes invalid after a full block)
- app/board/[dispatchId]/dispatch-reader.test.tsx > DispatchReader — automatic resume, no bookmark workflow > has no deliberate Save my place / ribbon UI and does not use reading_places
- app/board/dispatch-composer.test.tsx > DispatchComposer — FeatureIntroduction wiring > the Postcard slot activation is gated on showPostcardIntro, and its CTA opens the real picker, not just a dismissal (Section G/H)
- app/home/page.test.ts > Home Arrivals — unread-letter source of truth > does not determine the Home waiting card from sent lifecycle status
- app/home/page.test.ts > Home Phase 1B — omission/degradation behavior preserved > A Little Serendipity is still gated on serendipity.length > 0
- app/home/page.test.ts > Home Phase 1B — omission/degradation behavior preserved > From Minds You Keep is still gated on fromMindsYouKeep.length > 0 (omits cleanly when empty)
- app/home/page.test.ts > Home Phase 1B — omission/degradation behavior preserved > Recommended Minds still renders regardless of the Board candidate pool — the wide wrapper is guarded on EITHER pool being non-empty
- app/home/page.test.ts > Home Phase 1B — rendered section order > Recommended Minds sits between From Minds You Keep and A Little Serendipity
- app/home/page.test.ts > Home Phase 1B — rendered section order > renders Featured Board (From the Board) immediately after the personal/attention group
- app/home/page.test.ts > Home Phase 1B — rendered section order > renders kept writing through the compact identity-and-title shelf
- app/home/page.test.ts > Home Phase 1B — rendered section order > renders the ordinary Announcement teaser LAST — after every discovery/reading section
- app/home/page.test.ts > Home Phase 1B — rendered section order > renders the personal/attention group first, in order: Arrivals, Mail on the way, QuestionIncompleteNotice
- app/home/page.test.ts > Home Phase 1B — rendered section order > renders the simplified reading order: From the Board, From Minds You Keep, Recommended minds, A Little Serendipity
- app/home/page.test.ts > Home Recommended minds — bounded discovery (pre-launch performance) > fetches the recommendation page and the announcement in the main parallel round
- app/home/page.test.ts > Home Recommended minds — bounded discovery (pre-launch performance) > reuses the People discovery primitive, first batch, capped at six
- app/home/recommended-mind-card.test.tsx > RecommendedMindCard > Mindform + pseudonym + demographics are ONE link to the public profile route
- app/letters/[letterId]/photo-consent.test.tsx > PhotoConsent — passive branches render through TempaNote > enabled status (photos enabled): reports the settled state via TempaNote
- app/member-introductions.test.tsx > Member introductions — presentation contract > is mounted once in AppShell (not in onboarding, admin or compose)
- app/minds/page.test.ts > People page — discovery information architecture > keeps the non-blocking Question participation notice
- app/minds/page.test.ts > People page — discovery information architecture > preserves correspondence, moderation, pagination and stable-order boundaries (in the discovery RPC)
- app/minds/page.test.ts > People page — discovery information architecture > shows the People introduction only until its guide completion is persisted
- app/minds/page.test.ts > People page — discovery information architecture > the visible heading is People, never Minds
- app/minds/page.test.ts > People page — response-first discovery contract > requires a visible representative response without requiring the current Flagship specifically
- app/minds/page.test.ts > People page — response-first discovery contract > resolves saved Marks from opaque mark_id values and leaves null for legacy profiles
- app/minds/page.test.ts > People page — response-first discovery contract > uses calm People-level empty states without implying a system failure
- app/privacy/page.test.tsx > PrivacyPage > categories of information actually processed > covers profile fields: pseudonym, country, region, languages, optional gender
- app/privacy/page.test.tsx > PrivacyPage > categories of information actually processed > distinguishes public "Interests" (intent) from private reading interests, without conflating them
- app/privacy/page.test.tsx > PrivacyPage > does not invent unreleased functionality as current (no payments, ads, or Tempa Kids)
- app/profile-identity-surfaces.test.ts > canonical member identity surfaces > does not replace the anonymous shared-Dispatch identity with a profile Mark
- app/profile/question/page.test.ts > Checkpoint 2B, Section B — the actual page mirrors the tested pure decision for each guard > no-profile guard redirects to /profile, matching resolveOnboardingQuestionDestination
- app/profile/question/page.test.ts > Mark → Question stage enforcement > sends a mark-stage member back to Your Mark and a complete member onward
- app/profile/question/page.test.ts > Onboarding required-Question page — durable resume safety > documents central resumption plus route-local defense-in-depth checks
- app/profile/question/page.test.ts > Onboarding required-Question page — reuses the existing Question infrastructure, never a second save implementation > redirects to /profile (never straight into the Question, and never onward) when no profiles row exists yet — this step assumes the profile step already completed
- app/profile/question/page.test.ts > Onboarding required-Question page — reuses the existing Question infrastructure, never a second save implementation > the secondary "Answer another Question" path reuses the existing nextEligibleQuestion resolution, no second lookup
- app/question/[questionId]/page.test.ts > Question write page — response-management redirect target > redirects to /you/responses (never the retired /minds?view=answer) when the requested Question no longer exists
- app/question/question-answer.test.tsx > QuestionAnswer — inactive Question, no existing answer (direct-route invariant) > still offers a way back to My responses — never a dead end
- app/question/question-answer.test.tsx > QuestionAnswer — onboarding mode: post-first-save completion (source-level — setConfirmation is unreachable via SSR props) > shows the exact approved completion copy
- app/question/question-answer.test.tsx > QuestionAnswer — onboarding mode: post-first-save completion (source-level — setConfirmation is unreachable via SSR props) > the secondary CTA "Answer another Question" uses the existing Question infrastructure — the same server-resolved nextQuestion prop the ordinary Next button already uses, never a second lookup
- app/question/question-answer.test.tsx > QuestionAnswer — onboarding mode: three-Question education (genuinely first save only) > shows the three-Question education copy before a genuinely first save
- app/question/question-answer.test.tsx > QuestionAnswer — onboarding mode: three-Question education (genuinely first save only) > the ordinary (non-onboarding) edit mode still offers "Back to my responses" — nothing here removed that exit generally
- app/write/[recipientId]/first-letter-composer.test.tsx > FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E) > both "Back" links say "Back to People", still pointing at the unchanged /minds route
- app/write/[recipientId]/first-letter-composer.test.tsx > FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E) > the Sent screen (rendered when sent === true) is the one with "Back to People", not just the pre-send toolbar
- lib/writing-style-onboarding.test.ts > Writing Style — onboarding order: Mark → Flagship Question → Writing Style → Tempa > the Flagship completion screen continues to the step, then People
- tests/security/csp.test.ts > proxy CSP wiring > the auth gate still covers every originally protected route
- tests/security/platform-contracts.test.ts > database authorization contracts (docs/sql) > anon is granted nothing except the shared-Dispatch and public-Dispatch read paths
- tests/security/public-dispatches.test.ts > share image and media > JSON-LD uses the only dangerouslySetInnerHTML in the app, always through the escaping helper
- tests/security/public-dispatches.test.ts > the author’s choice > composer copy says plainly that Public means the open web

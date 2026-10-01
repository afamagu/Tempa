# Editorial and reserved-pseudonym verification — 2026-09-30

Baseline: `main` at `6240eee2c7737e2188dec9db15c854971a5f25e0`.

## Result

- Full suite before the two additional form tests: baseline 5,735 tests; completed editorial/follow-up 5,789 tests. Exactly the same 56 test failures, with no new failures. Both additional form interaction tests passed separately.
- Reserved-rule, migration, Board header, editorial surfaces and existing profile-form focused run: 50/50 passed.
- SQL verifier in PGlite after the production editorial migration: 27 checks plus OVERALL passed. Additional probes against the real fixture profiles table confirmed INSERT/UPDATE protection, spoofed-status rejection, normal signup, safe migration rerun and collision preflight rollback.
- Lint: baseline and completed branch both have 13 errors and 27 warnings.
- Next production webpack compilation succeeds with local substitute fonts. Both baseline and completed branch fail subsequent generated page type validation on the same three existing extra exports: `resolveOnboardingQuestionDestination`, `resolveWritingStyleNext`, and `getAuthErrorMessage`. No build-success claim is made.
- Google Fonts and a local Chromium executable were unavailable. Header markup/rendering was tested; a fresh browser screenshot at 360px was not captured. The byline/dateline use the full header width beneath the name/Keep row.

## Activation

PR #52 includes the editorial migration already reported applied and verified in production. Its Room conflict resolution requires no additional SQL.

The follow-up SQL is prepared, not applied to production. Run `docs/sql/2026-10-30-reserved-pseudonyms.sql`, then `docs/sql/2026-10-30-reserved-pseudonyms-verify.sql`. Expect every pass including OVERALL to be true. The migration first audits existing ordinary names and aborts rather than renaming anyone.

The rule reserves canonical prefixes `tempa` and `ladylarkspur`, ignoring case, spaces and hyphens, and including appended letters/numbers such as `Lady Larkspurr` and `Tempa Support`. Ordinary names such as `Larkspur` and `Temperance` remain allowed.

## Exact baseline test failures

- `app/app-shell.test.tsx` — AppShell — People rename (Onboarding & First-Use checkpoint) the "minds" nav item is labeled People, not Minds, in both the desktop sidebar and mobile bar
- `app/app-shell.test.tsx` — AppShell — People rename (Onboarding & First-Use checkpoint) the underlying route stays /minds — only the visible label changed
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment marks exactly the home nav item active when that key is the active prop
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment marks exactly the letters nav item active when that key is the active prop
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment marks exactly the minds nav item active when that key is the active prop
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment marks exactly the board nav item active when that key is the active prop
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment marks exactly the you nav item active when that key is the active prop
- `app/app-shell.test.tsx` — AppShell — mobile bottom nav active-location treatment preserves the existing navigation hrefs unchanged
- `app/block-button.test.tsx` — BlockButton call-site wiring — fullBlockRedirect the public profile page passes fullBlockRedirect="/minds" (its own route becomes invalid after a full block)
- `app/member-introductions.test.tsx` — Member introductions — presentation contract is mounted once in AppShell (not in onboarding, admin or compose)
- `app/profile-identity-surfaces.test.ts` — canonical member identity surfaces does not replace the anonymous shared-Dispatch identity with a profile Mark
- `lib/writing-style-onboarding.test.ts` — Writing Style — onboarding order: Mark → Flagship Question → Writing Style → Tempa the Flagship completion screen continues to the step, then People
- `app/board/dispatch-composer.test.tsx` — DispatchComposer — FeatureIntroduction wiring the Postcard slot activation is gated on showPostcardIntro, and its CTA opens the real picker, not just a dismissal (Section G/H)
- `app/home/page.test.ts` — Home Phase 1B — rendered section order renders the personal/attention group first, in order: Arrivals, Mail on the way, QuestionIncompleteNotice
- `app/home/page.test.ts` — Home Phase 1B — rendered section order renders Featured Board (From the Board) immediately after the personal/attention group
- `app/home/page.test.ts` — Home Phase 1B — rendered section order renders the simplified reading order: From the Board, From Minds You Keep, Recommended minds, A Little Serendipity
- `app/home/page.test.ts` — Home Phase 1B — rendered section order Recommended Minds sits between From Minds You Keep and A Little Serendipity
- `app/home/page.test.ts` — Home Phase 1B — rendered section order renders the ordinary Announcement teaser LAST — after every discovery/reading section
- `app/home/page.test.ts` — Home Phase 1B — rendered section order renders kept writing through the compact identity-and-title shelf
- `app/home/page.test.ts` — Home Phase 1B — omission/degradation behavior preserved From Minds You Keep is still gated on fromMindsYouKeep.length > 0 (omits cleanly when empty)
- `app/home/page.test.ts` — Home Phase 1B — omission/degradation behavior preserved A Little Serendipity is still gated on serendipity.length > 0
- `app/home/page.test.ts` — Home Phase 1B — omission/degradation behavior preserved Recommended Minds still renders regardless of the Board candidate pool — the wide wrapper is guarded on EITHER pool being non-empty
- `app/home/page.test.ts` — Home Arrivals — unread-letter source of truth does not determine the Home waiting card from sent lifecycle status
- `app/home/page.test.ts` — Home Recommended minds — bounded discovery (pre-launch performance) reuses the People discovery primitive, first batch, capped at six
- `app/home/recommended-mind-card.test.tsx` — RecommendedMindCard Mindform + pseudonym + demographics are ONE link to the public profile route
- `app/minds/page.test.ts` — People page — discovery information architecture the visible heading is People, never Minds
- `app/minds/page.test.ts` — People page — discovery information architecture shows the People introduction only until its guide completion is persisted
- `app/minds/page.test.ts` — People page — discovery information architecture preserves correspondence, moderation, pagination and stable-order boundaries (in the discovery RPC)
- `app/minds/page.test.ts` — People page — discovery information architecture keeps the non-blocking Question participation notice
- `app/minds/page.test.ts` — People page — response-first discovery contract requires a visible representative response without requiring the current Flagship specifically
- `app/minds/page.test.ts` — People page — response-first discovery contract uses calm People-level empty states without implying a system failure
- `app/minds/page.test.ts` — People page — response-first discovery contract resolves saved Marks from opaque mark_id values and leaves null for legacy profiles
- `app/privacy/page.test.tsx` — PrivacyPage categories of information actually processed covers profile fields: pseudonym, country, region, languages, optional gender
- `app/privacy/page.test.tsx` — PrivacyPage categories of information actually processed distinguishes public "Interests" (intent) from private reading interests, without conflating them
- `app/privacy/page.test.tsx` — PrivacyPage does not invent unreleased functionality as current (no payments, ads, or Tempa Kids)
- `app/question/question-answer.test.tsx` — QuestionAnswer — inactive Question, no existing answer (direct-route invariant) still offers a way back to My responses — never a dead end
- `app/question/question-answer.test.tsx` — QuestionAnswer — onboarding mode: three-Question education (genuinely first save only) shows the three-Question education copy before a genuinely first save
- `app/question/question-answer.test.tsx` — QuestionAnswer — onboarding mode: three-Question education (genuinely first save only) the ordinary (non-onboarding) edit mode still offers "Back to my responses" — nothing here removed that exit generally
- `app/question/question-answer.test.tsx` — QuestionAnswer — onboarding mode: post-first-save completion (source-level — setConfirmation is unreachable via SSR props) shows the exact approved completion copy
- `app/question/question-answer.test.tsx` — QuestionAnswer — onboarding mode: post-first-save completion (source-level — setConfirmation is unreachable via SSR props) the secondary CTA "Answer another Question" uses the existing Question infrastructure — the same server-resolved nextQuestion prop the ordinary Next button already uses, never a second lookup
- `tests/security/csp.test.ts` — proxy CSP wiring the auth gate still covers every originally protected route
- `tests/security/platform-contracts.test.ts` — database authorization contracts (docs/sql) anon is granted nothing except the shared-Dispatch and public-Dispatch read paths
- `tests/security/public-dispatches.test.ts` — share image and media JSON-LD uses the only dangerouslySetInnerHTML in the app, always through the escaping helper
- `tests/security/public-dispatches.test.ts` — the author’s choice composer copy says plainly that Public means the open web
- `app/board/[dispatchId]/dispatch-reader.test.tsx` — DispatchReader — automatic resume, no bookmark workflow has no deliberate Save my place / ribbon UI and does not use reading_places
- `app/letters/[letterId]/photo-consent.test.tsx` — PhotoConsent — passive branches render through TempaNote enabled status (photos enabled): reports the settled state via TempaNote
- `app/minds/[userId]/people-profile-back.test.ts` — People profile return navigation sanitizes the return destination before using it as an href
- `app/minds/[userId]/people-profile-back.test.ts` — People profile return navigation renders a clear back affordance
- `app/profile/question/page.test.ts` — Onboarding required-Question page — reuses the existing Question infrastructure, never a second save implementation the secondary "Answer another Question" path reuses the existing nextEligibleQuestion resolution, no second lookup
- `app/profile/question/page.test.ts` — Onboarding required-Question page — reuses the existing Question infrastructure, never a second save implementation redirects to /profile (never straight into the Question, and never onward) when no profiles row exists yet — this step assumes the profile step already completed
- `app/profile/question/page.test.ts` — Onboarding required-Question page — durable resume safety documents central resumption plus route-local defense-in-depth checks
- `app/profile/question/page.test.ts` — Mark → Question stage enforcement sends a mark-stage member back to Your Mark and a complete member onward
- `app/profile/question/page.test.ts` — Checkpoint 2B, Section B — the actual page mirrors the tested pure decision for each guard no-profile guard redirects to /profile, matching resolveOnboardingQuestionDestination
- `app/question/[questionId]/page.test.ts` — Question write page — response-management redirect target redirects to /you/responses (never the retired /minds?view=answer) when the requested Question no longer exists
- `app/write/[recipientId]/first-letter-composer.test.tsx` — FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E) both "Back" links say "Back to People", still pointing at the unchanged /minds route
- `app/write/[recipientId]/first-letter-composer.test.tsx` — FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E) the Sent screen (rendered when sent === true) is the one with "Back to People", not just the pre-send toolbar

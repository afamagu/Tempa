# Member introduction restoration and merge backlog audit

## Backlog audit

At production main 1fc24278b6ac17ed906ddcbe424e7ab7d20abe7e, GitHub has zero open PRs. Every retained feature/fix branch is an ancestor of main: language-first onboarding, recovered Letters discovery, reserved pseudonyms, Room engagement, unavailable-resource states, Discover correction, Dispatch body ceiling, Moment recovery and Quill labels. Adult eligibility, email delivery and Claude handover are also ancestors. These are retained branches, not outstanding releases.

The preserved-codex-email-launch-audit-2026-09-22 branch has six diverged historical commits. Its four changed files cover arrival rendering/art manifest, header-injection safety, tests, exact-letter auth return, and the launch audit. The current main already has the renderer/manifest/header protections, richer artwork and worker tests, and exact-letter next redirect. The old audit's claim that no application email sender exists is obsolete. Do not merge that archived implementation over current production or delete the preserved branch. Current arrival renderer tests pass. No new member messages or emails were sent during this audit.

## Original feature and restoration

Original MemberIntroductions was mounted in AppShell by 9d220b6 and unmounted during Room consolidation in 6240eee. The card stack, data layer, SQL migration and tests remained. Restore that original floating writing-led presentation, bounded to seven people; Home remains visible behind a translucent backdrop. Preserve left-only deliberate advancement, interior vertical scrolling, Next/Done, Close, Escape and reduced-motion behavior. Mark/name now open the canonical profile; focus wraps in the dialog and returns to the actual underlying control on close.

Presentation is gated by actual /home pathname, not just active navigation label. A new auth session gets one initial check on Home. Refresh and menu navigation do not repeat it. After twenty minutes with the tab/window away, a return checks only never-presented newcomers (original SQL priority tier 0). Old/presented/established cards cannot reappear on that long-return path. Empty or failed results leave Home available. The original initial stack still follows the original database ranking; it may include eligible established people when no newer people exist.

A single local presence tracker persists through focused composers that don't mount AppShell, so active reading/writing or menu use doesn't become a false long absence. It writes only UI visit timestamps, makes no network/DB calls, and stops/replaces itself when the auth session changes. Auth-session-keyed local storage suppresses refresh/remount repetition; blocked storage uses in-memory suppression. Durable candidate history remains database-owned. Client session ids only control presentation, never content authorization.

## Navigation

Direct introduction → profile uses /room/{id}?returnTo=/home; its back link deterministically returns Home and doesn't reopen the stack. Direct introduction → first letter retains answer context and returns Home before/after sending. Profile → first letter returns to that profile, preserving its Home return. Known reading destinations are sanitized and unrelated/external return paths fall back to The Room. Logged-out profile/compose requests retain exact context through sign-in. Current first-letter Safety evaluation and send RPC are unchanged; no letter is sent by this restoration.

## Validation and production prerequisite

Production build/TypeScript passed. 124 focused interaction, timing, navigation, composer Safety, profile, Discover, email renderer and i18n tests passed. Relevant lint has no errors or warnings. Original SQL plus the restoration's read-only preflight passed isolated PostgreSQL fixtures for established/newcomer/seen priority, consume exclusion, bounded retrieval, owner history RLS and anonymous denial. These fixtures do not verify production SQL or the authenticated production UI.

Run docs/sql/2026-10-01-member-introductions-preflight.sql. Expected MEMBER_INTRODUCTIONS_READY with all seven flags true. This is read-only and reuses existing functions/tables; no new migration is needed if ready. If not ready, inspect missing checks and supply a forward repair before release. Keep PR draft until production prerequisites are verified. No publishing, email switches, Storage or Vercel settings changes. Live Room Question selection, refreshed Moment image acceptance and signed-in UI acceptance are separate unresolved live checks, not an unmerged feature backlog.

# Tempa: complete-flow release plan

Status: implementation started locally; not deployed. Production baseline main 9ffb4b5ceeafec6a886569ec396a4684c6a30536. Production SQL remains user-applied.

## 1. Public sharing

The supplied /board/e6e80653-cc53-48e8-88d3-15abc9ecfdef URL is an authenticated reader, not the /d/token public link. Preserve Board authentication. Make the Share action's public URL accessible after native sharing/copying; recover from native share failures. Permit designated social preview crawlers to fetch /d/ and generated images while retaining general noindex policy. Verify actual public token metadata, image response, revocation, correct public author identity, anonymous reading, joining and return destination. Instagram export is a separate deliverable, not a promised URL unfurl.

## 2. Mentions and notifications

Empty search: six established correspondents. Typed prefix: matching eligible members across Tempa, correspondents ranked first. Explicit identity selection; private correspondence excludes active mentions. Honour blocks, account state and profile visibility. Atomic publication and mention persistence; edits/removals do not duplicate notifications. In-app recipient-only history and exact source links. Official posts expose publication identity, never the administrator behind them.

Email: unread delay, recipient preferences, stronger limits for non-correspondents, deduplicated queue, retries and delivery status. Recheck visibility/block/removed mention before send. No historical queue blast. No real-user test emails without explicit authorization.

## 3. Room and page hierarchy

Moss/ivory suggestion panel between current answers and archive. Explain profile visibility and editorial consideration accurately. Preserve form validation, credit preference, success and error states. Prototype editorial title treatment without altering user writing fonts. Audit Home, Board, Letterbox, Discover, profile, composers and settings for narrow viewport, keyboard, focus, back navigation and empty/error states.

## 4. Attribution and answer Moments

Optional creator/source/licence details after upload; readable About this image panel beside reporting. Credit is not permission. Review existing legal/reporting process with jurisdiction-appropriate legal review. Extend public Moment infrastructure to answers with owner-scoped drafts, publication checks, stable attachment ordering and refresh recovery. Preserve private letter unlock rules, audience controls and original reading position.

## 5. Ten-second videos

Choose photo or video / Use camera. Existing photo interaction retained. Short video preview; longer video thumbnail timeline and movable selection of at most ten seconds, shorter clips allowed. Preview selection before confirmation. No autoplay in feed; viewer controls sound/play/replay/close/report. Validate actual media contents, decode and verify output duration server-side. No generic document upload. Processing infrastructure must be established before enabling the composer; do not rely on browser duration checks. Handle mobile codecs, rotation, upload interruption, progress/retry, draft persistence, temporary-source cleanup and private delivery. No burnt-in watermark on personal media; explicit export can carry branding.

## 6. Approximate admin geography

Disclosed connection country/region only; never covert precise-device tracking. Separate profile country from estimated connection geography, timestamp observations, restrict/audit access and define retention. No automatic misconduct decision from a mismatch. Aggregate growth reporting rather than exposing unnecessary raw IPs.

## 7. Editorial pilot

Working title The Tempa Review, subject to naming check. Four to six editor-selected pieces, cover, credits and responsive reading. Shortlist -> contributor permission -> draft -> preview -> approval -> publication -> Home placement -> archive. Private letters excluded; member-only answers require permission for public republication. Optional newsletter subscription separate from account notifications.

## Release gate for each batch

Trace entry, action, save, destination, back path, cancellation and failure. Verify authorization and audience at every server boundary. Run focused regression tests plus mobile/desktop visual checks. Prepare additive migration and verification where required; user runs production SQL before dependent frontend release. Report tested, deployed and outstanding separately. Do not bundle unfinished video processing or email delivery behind a working-looking button.

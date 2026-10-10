# Native writing improvements verification — 2026-10-10

Base: main ef05f860ad5b412d47418506333cf38418232793.
Branch: feat/native-writing-improvements-2026-10-10.

## Changes

Use the existing Tiptap/ProseMirror editor and browser contenteditable behavior. Disable whole-composer transaction rerenders; subscribe separately to eligibility and toolbar state. Batch draft serialization with 300ms debounce and 1200ms maximum wait. Flush on blur, pagehide, hidden visibility, Preview and Send; cancel pending writes before clearing a successful draft. Keep existing draft formats and scopes; retain legacy drafts if migration storage fails.

Enable native autocorrect alongside existing spellcheck, sentence capitalization and text input mode. Blur and wait for the editor's native composition processing before taking Preview/Send snapshots; never force private composition state. Recheck final input against the safety-evaluated snapshot and require review when the draft changed. Preserve all RPC names, safety parameters, permissions, delivery, photo paths and postcard payloads.

Offer selectable LOL/haha/happy/smile/love/thanks/sad/wow emoji choices without automatic replacement. Preserve word boundaries, punctuation, formatting and Undo. Keep viewport accommodation passive; cancel queued geometry updates during touch and reset on orientation changes. Handle canceled keyboard-dismiss gestures.

## Automated verification

- Clean production build: PASS (npm run build). Initial recovered Turbopack persistence cache and generated validator were corrupt after the previous interrupted environment; moving the generated .next cache aside resolved this without source changes.
- TypeScript: PASS in the clean production build.
- Changed-file ESLint: zero errors; one existing no-img-element warning in Moments composer.
- Focused editor, composition, emoji, draft, viewport, keyboard and document tests: 166/166 pass across eight files.
- Full branch suite: 6105 passed, 102 failed, 6207 total.
- Clean main baseline: 6090 passed, 102 failed, 6192 total.
- Compared complete failure identities: no new or resolved failures. The existing 102 failures remain outside this change.
- Previous implementation-session Chromium automation passed at 390x844, 412x915 and desktop viewports: native attributes, optional emoji replacement, immediate refresh recovery, failed Send preserving draft, retry sending exactly evaluated text, no duplicate send, cleared draft remaining empty after refresh. Used the real first-letter composer with mocked safety/Supabase responses. Temporary browser fixture route is excluded from the branch.
- SQL, Storage policies and production data: no changes applied.

## Device and live-service limits

Phone-sized Chromium is not Safari or Gboard testing. No physical iPhone/Android keyboard testing was performed. Mocked delivery proves client request behavior, not real recipient delivery. Signed-in recipient playback/delivery and attachment service flows require live account/device verification. Photos/postcards retain their existing implementation and are covered by document/draft tests; there is no claim of fresh live upload verification.

## Real-phone follow-up

On iPhone Safari and Android Chrome/Gboard, type long paragraphs, use predictions/autocorrect and multilingual composition, rotate, scroll with the keyboard open, select formatted text, choose a LOL emoji, and immediately Preview/Send after a prediction. Refresh/background/reopen while drafting. Retry a failed send and check the recipient sees exactly the final draft. Attach a photo and postcard, refresh, send, and confirm recipient display and delivery timing.

The earlier optional Video Moments retirement SQL remains separately approval-gated and is not required for these writing changes.

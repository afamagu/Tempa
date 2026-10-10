# Video retirement and mobile writing review — 10 October 2026

## Scope and production evidence

Started from main 38388f7 (PR #116). Reverse only the client/runtime additions from PR #109; retain PRs #110–116, photos, text, letter-level postcards, permission checks, correspondence lifecycle, follow-ups and delivery RPCs. Video repair PR #117 was never merged and is superseded. Production query found zero video Moment rows and 58 photo Moment rows. No member letters, photo objects or correspondence records are deleted.

Removed the video source option, file input, trimming dialog, editor node, reader playback, draft/RPC video payloads and video signing. Saved drafts containing a retired video node restore all surrounding text, formatting, paragraphs and photos. Historical SQL is retained as migration history, not reverted wholesale: reverting old letter RPC definitions would overwrite later delivery/lifecycle work.

## Writing review

Reviewed current first-letter, first-contact response, ongoing-letter and Dispatch composers; shared writing schema/toolbar; keyboard-dismiss and VisualViewport hooks; local draft persistence; preview and send flow; PR #116 native-scroll changes and recent repository checkpoints. This is a repository review, not access to unrelated ChatGPT conversations.

### Keep

* Shared Tiptap/ProseMirror schema with native contenteditable input. Formatting toolbar restores the selection. No custom keyboard implementation or interception of ordinary text entry.
* Native sentence capitalization, spellcheck, prose input hints, 18px editor text and touch-sized controls.
* Natural document scrolling; no fixed-height nested editor scroller, automatic caret scrolling, selectionchange scroll handler or non-passive touch cancellation. Drags beginning inside the editor do not blur it.
* First-letter screen top-anchored on mobile. Android layout-resize viewport request and VisualViewport fallback reserve for Safari.
* Scoped drafts, visible storage-failure feedback, separate postcard draft, safety checks and delivery through existing RPCs.

### Remaining risks, ordered by impact

1. Long drafts: every onUpdate synchronously serializes the entire document into localStorage; shouldRerenderOnTransaction also rerenders each composer for every selection/content transaction. This is verified code, but device latency is not measured. Profile a long draft before changing; consider a short debounced persistence queue with guaranteed flush on blur/pagehide/preview/send, and subscribe narrowly to toolbar/document changes. A debounce without flush would risk lost words.
2. Predictive text/IME: send handlers do not explicitly check editor.view.composing. Native input is handled by ProseMirror, so this is a test gap rather than a proven lost-word bug. Test Gboard suggestions, iOS autocorrect, dictation, emoji, mid-word preview and immediate Send. Capture committed content once for safety evaluation and sending if a mismatch is observed.
3. Keyboard reserve: reservedInset only grows while focused. Rotation or changing keyboard height may leave extra bottom whitespace until focus changes. This prevents shrink-induced jumps but needs real-device coverage; do not add forced scrolling.
4. Draft isolation: local draft keys identify recipient/correspondence, not the signed-in author. Test account switching on a shared device and audit logout cleanup; include author scope in a separately planned compatible migration if drafts survive account switching.
5. Physical keyboard behavior remains unverified. A desktop browser at phone dimensions does not reproduce real iPhone Safari/Gboard keyboard, viewport panning or native selection. The existing mobile scroll test is a source contract, not end-to-end phone certification.

## Build blockers repaired

Latest main has an undefined hiddenCorrespondenceIds in getLetterboxPeople and TypeScript closure narrowing errors for root/viewport. Restore the existing hidden-ID query/filter and retain narrowed values through an arrow callback; these are small build repairs, not writing redesign. Remove a misleading test-triggering comment naming a forbidden scrolling method; runtime already does not call it.

## Backend retirement

Forward-only migration: supabase/migrations/20261010103000_retire_video_moments.sql. It restores the private bucket to JPEG-only without changing the photo size limit, rejects new/updated video Moment rows, disables the video-upload helper and removes video draft-read policy. Keeps all photo policies, rows and letter RPCs intact. Verifier: docs/sql/2026-10-10-retire-video-moments-verify.sql. Production SQL remains unapplied pending explicit approval, as originally required.

## Validation

Focused suite: 203/203 passing across draft, document conversion, Moments, mobile scroll and keyboard dismissal. New draft compatibility test round-trips mixed legacy video/text/photo drafts. TypeScript passes. Changed-file ESLint: zero errors, three existing warnings. Full suite and production build results recorded in PR. Protected preview live browser checks and physical devices remain access/testing limitations; no claim of complete phone verification.

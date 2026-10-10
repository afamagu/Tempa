# Video Moments repair — 2026-10-10

Base: `main` at `38388f7ccb097e8d020f6c2c6770c99ccbe074ea` (PR #116 merge).

## Verified production cause

Read-only production inspection confirmed `letter-photos` is private, has a 5,242,880-byte limit and accepts only `image/jpeg`. The existing `confirmVideoMoment` sends the original video File to that bucket. Every selected video MIME is therefore incompatible with the actual destination. The generic catch masks the Storage error. Available recent logs did not include the reported failed video request, so this diagnosis is based on the exact production configuration and client upload contract, not a recovered request trace. The video columns, constraints and write_letter video validation are installed.

The old trim dialog does not extract a clip: it uploads the complete original, then stores start/duration. Recipient playback restrictions alone cannot protect the remaining footage. Draft signing also uses `can_view_letter_photo`, which requires an attached Moment; an unsent uploaded video cannot restore its signed URL after refresh.

## Implementation

- Locally decode/re-encode only the selected range as H.264/AAC MP4. Never upload the original or fall back to it. Start timestamps on new attachments are zero.
- Load a pinned, same-origin, single-thread FFmpeg WASM worker only when attaching. Build/dev scripts generate assets from locked dependencies; no CDN, service key, cross-origin-isolation or Vercel multipart upload is needed.
- Source limit: 100 MB to bound mobile memory; output limit: the unchanged 5 MB bucket limit. Encode to at most 640 pixels per side, 30fps, with bounded bitrate. Preparation/upload timeouts and cancellation leave the existing letter intact.
- Show the whole-source timeline, selected window, exact start/end values and a selected-only preview; disable repeat submissions while preparing/uploading.
- Show actual upload bytes progress, preserve selection and prepared clip on retry, and reuse the UUID to recover uncertain upload outcomes without creating multiple attachments.
- Drafts persist the durable clip path. Only the uploader can sign an unsent video; the existing recipient delivery/consent/block policy remains authoritative. Locked videos expose the same consent decision as photos.
- Reader playback reports errors and can obtain a fresh signed URL on retry.
- Forward migration adds MP4 support without increasing the bucket's size limit, adds video-specific restrictive insertion checks and uploader draft access, and validates new Moment references against uploaded clips. Existing letter RPCs, delivery and idempotency functions are unchanged.

Two existing `main` build blockers required minimal repairs: closure narrowing in `useEditorVisualViewport`, and an undefined `hiddenCorrespondenceIds` in `getLetterboxPeople` (restore the existing hidden-set query/filter).

## Evidence

- Actual pinned WASM encoder: 20-second red/green/blue source, select 5–15s. Result: 10.000000 seconds, 136,061 bytes, H.264/AAC, 300 decoded frames, every frame green. No red or blue footage in the stored output.
- 15 new regression tests pass, including eight isolated PostgreSQL tests applying the exact migration with production-equivalent policy fixtures: uploader drafts, recipient/outsider denial, JPEG preservation, MIME disguise rejection, delivery/consent gates, blocked users, invalid duration/start and missing objects.
- TypeScript and production build pass.
- Full test baseline on untouched main: 48 failed files, 106 failed tests, 6,085 passed. Initial fix run: same 106 failures plus seven new passing tests; final full run to be recorded below.
- Repository ESLint baseline: 14 errors, 41 warnings. Changed video files: no errors; existing composer image warning only. Final full lint to be recorded below.
- Physical iPhone Safari / Android Chrome and live sender→recipient workflow are not yet verified. Browser-engine check results will be added before review.

## Deployment order and approval

1. Review and explicitly approve `supabase/migrations/20261010053745_video_moments_storage_repair.sql`. No production SQL has been applied by this work.
2. Apply the migration, then run `docs/sql/2026-10-10-video-moments-storage-verify.sql`; every boolean must be true.
3. Test the preview with two authorized test accounts in a qualified correspondence. Select a distinctive source; choose a nonzero window; preview, upload, attach, refresh draft, send, wait for delivery, accept media consent where required, open recipient clip, refresh and reopen. Retrieve the authorized downloaded file and check it contains only the selected footage. Check retry under network interruption and verify JPEG Moments still work.
4. Test physical iPhone Safari and Android Chrome. Test a short clip, a longer landscape/portrait clip, MOV/HEVC where decoding is supported, silent video, cancelling, 100 MB source rejection and offline retry. Device emulation is not a substitute for these tests.
5. Merge only after the required checks pass. Migration approval does not authorize merging this PR.

The migration has a configuration precondition that intentionally fails if another change has altered the bucket; inspect and reconcile rather than overwriting it. It is forward-only and must not be rerun after success.

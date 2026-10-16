# Tempa Moments and fraud hardening — 16 October 2026

## Scope
Tracks #130 (photo marking), #131 (financial-fraud warnings and consent), and #132 (photo corruption after long-running drafts).

## Confirmed root cause for #132
Drafts persist a durable `imagePath`, but photos upload *before* a letter is sent. Production Storage SELECT originally called `can_view_letter_photo(name)`, which requires a `moments` row belonging to a *sent* letter. Thus authors could upload unsent photos but could not later re-sign their own draft image URLs after the original blob URL expired. Existing bounded retry logic could never overcome permanent Storage policy denial.

The added `letter_photos_own_drafts_select` rule is scoped to the original uploader, authenticated role, valid correspondence and a UUID/UUID.jpg key; it DOES NOT grant an unsent-photo reader permission to a recipient. This policy was applied to the live Supabase project and its existence/scope was checked via `pg_policies`.

Drafts must retain the durable path, not the transient blob URL. Preview now refreshes expired signed URLs and prevents a photo that could not be resolved from being presented as send-ready; reattempting Preview retries without deleting the draft.

## #130 implementation
A source photo is prepared locally and presented in a mobile canvas editor. The writer can draw in red (finger/stylus/mouse), undo individual strokes, clear all, cancel, or include the image unchanged. A marked JPEG is generated locally and uploaded to the existing private `letter-photos` bucket using the existing consent workflow. No database/photo metadata change and no third-party annotation service. This does not yet add the ability to annotate *after* an already attached Moment has been inserted.

## #131 audit
- The shipped `/api/safety/evaluate` is authenticated; it checks user-scoped rate limits and context authorization before classification, and stores a server-side evaluation.
- `classifyContent` evaluates context/recipient-directed solicitations, not bare money keywords. Confirmed financial solicitations are currently denied; they are **not** permitted after a warning acknowledgement.
- Existing delivery RPCs verify single-use, content-matched safety evaluations. Failures of safety checks do not silently send without screening.
- Sharing contact details uses a separate, non-accusatory caution flow; reporting and account interventions exist.
- Adult discussion of sexuality or money is not inherently a financial-solicitation pattern. Added concrete regression cases for legitimate personal letters vs direct requests for money/gift cards and money forwarding.
- Photo Moments and consent are a separate mechanism; letter-level eligibility and revocable photo permissions are maintained by existing correspondence rules.
- Historical production aggregates checked without viewing private letter contents: 84 evaluations, 81 allowed, 2 denied, 1 warned; these demonstrate system use, **not** perfect detection.
- No fraud detector offers a 100% guarantee. Continue adversarial regression tests against coercion, language variations, obfuscation and false positives.

## Release verification still required
GitHub PR quality gate, current Vercel preview build, interactive iOS Safari test using a multiple-day draft, annotation canvas and image file size, fresh/expired signed URL recovery, send delivery and photo consent, and a manual financial-solicitation/benign-money smoke test in non-production test correspondence. Keep main unchanged until quality gates pass. No test user content should be copied into logs.

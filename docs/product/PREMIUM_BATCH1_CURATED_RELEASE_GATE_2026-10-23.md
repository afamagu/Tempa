# Premium Postcards — Batch 1 intake and release gate (23 Oct 2026)

## Scope and verified assets
The owner supplied 117 actual attachments (57 PNG and 60 MP4). SHA-256 deduplication found **47 distinct still images**, **48 distinct video byte sequences**, and **22 exact-duplicate groups**. All 60 videos have duration 10.04 seconds; stills are 941×1672 (one 940×1672); no media file exceeds 20 MiB.

- **46 matching still/motion pairs** are proposed for release.
- **Guest Room 13**: HOLD (owner's prior motion/layout concern). **Lady Larkspur**: REMOVED by owner — must not be shipped or listed.
- Two distinct unassigned motion files are quarantined, NOT new products: generated_video (11)(2).mp4 (likely held guest motion; visually verify) and generated_video (4)(1).mp4 (alternate motion for Something Worth Keeping).
- Filename typos and repeated '(1)'/'(2)' copies must not create products. SHA-256 and title mapping in the packaged CSV are authoritative.
- IMPORTANT: This is **not** a completed published release. Assets are still local; authenticated Supabase Storage upload remains required.

## Simple member UX
Reuse **one existing /you/postcards catalogue and one postcard picker**, not separate storefronts or five navigation destinations. On the browsing surface show a search box, a horizontal chip row: **Featured · For Someone · Feelings & Moods · Occasions · Stories & Worlds · Places & Journeys · Free**, and the same postcard-card grid. Use primary categories for browsing, multiple taxonomy terms for cross-discovery, and featured shelves for editorial ranking. All 38 old complimentary cards remain available (do not migrate or delete). The six new free starters get the same card design and presentation as paid cards. Keep **Collections** hidden until a published 6-card offer exists; do not add new top-level navigation.

## Pricing
- Six new complimentary starter postcards: For the Good Company; Same Nonsense, Different Day; Another One, Please; The Conversation Continues; Just Before; Kept.
- **40 paid singles, 100 Credits each**.
- **One curated 6-card bundle, 500 Credits**, selected from premium cards; must use commerce server-authoritative checkout and entitlements, not client-side pricing.
- The same artwork should be usable in a letter through the existing postcard picker. Motion previews should be deliberate, never autoplay audio.

## Safety and launch prerequisites
1. Final manual motion QA; isolate any motion that loses postal composition/typography.
2. Create image/jpeg at quality 92, keep original supplied 10.04-s MP4. Normalize filenames to `<slug>.jpg` and `<slug>.mp4`. Verify each SHA-256 against staged manifest, ensure all 92 expected assets match.
3. Change `premium-batch-upload.tsx` and its imported batch manifest to **46** pairs / **92** reviewed files with current source hashes. The existing uploader still refers to 47/94 and rejects this curated upload. Do not run it unchanged.
4. Update `docs/sql/2026-10-12-premium-postcards-catalogue-release.sql` with the *same* current hashes, remove Lady Larkspur, mark six free, review 40 paid product prices and collection membership. Do not run old SQL unchanged: it embeds an obsolete manifest and requires 94 prior prepared media objects.
5. Only after upload integrity and product-terms/entitlement tests: publish/activate through existing audited admin RPCs. Keep commerce payment/checkout feature switches unchanged.
6. Verify from member side: category chips/search, free send, paid lock, real Credits balance, six-pack grant, mobile viewport, images, motion preview, old 38 cards and Keepsakes.
7. No direct SQL shortcuts to spoof authorization in production; admin policies and functions must remain authoritative.

## Operational notes
This branch records the real intake and release constraints without making risky changes to production. The validated media and catalogue CSV are provided in the conversation as downloadable artifacts. The media files have not been committed to Git.

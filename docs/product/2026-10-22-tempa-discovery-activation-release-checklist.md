# Tempa Discovery Activation — protected release checklist

## Current branch
This feature is staged in a draft PR, not deployed to production until verification and the database migration pass.

## Storage and release
- No postcard/media assets, no new dependencies, no new API/text-generation service.
- Limit preview deployments. Release only with working rollback and available Vercel headroom.
- Premium Batch 1 remains in the admin uploader and Supabase Storage.

## Profile introductions
- Dedicated active Question with slug `tempa-profile-introduction`. It is **not** a Board letter.
- Existing safety-evaluated Question-answer RPC is the publication path.
- The new flag defaults to private. Reader RLS, first-contact safety, the first-letter core, and discovery must all enforce it.
- Readers see ordinary letters first; otherwise they see an approved visible profile introduction.
- No private correspondence is created by Auto-Match itself.
- Hiding introduction must remove it from discovery/new first contact and preserve already-sent private letters.

## Release gates
- Verify schema migration against a snapshot/preflight and then apply once.
- Validate fresh signup, six/fewer/zero matches, skip, private letters, Board guide, browser refresh, own draft protection.
- Verify QA is never promoted to an open letter; hidden intros cannot be used for new correspondence.
- Verify blocked/deactivated/suspended members, capacity, existing and pending episodes, moderation and withdrawal.
- Verify desktop, iPhone Safari keyboard/viewport and Android Chrome keyboard/viewport.
- Run all quality, security, DB contract tests, then one production release.

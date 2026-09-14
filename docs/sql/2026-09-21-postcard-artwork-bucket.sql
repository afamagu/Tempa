-- ============================================================
-- TEMPA — POSTCARD-ARTWORK STORAGE BUCKET (ADMIN PHASE 2A-2, PART 2/3)
-- ============================================================
-- STATUS: LIVE. Manually applied AFTER docs/sql/2026-09-21-postcard-
-- admin-and-keepsakes.sql (the Core transaction) succeeded. Do not
-- rerun casually — `on conflict (id) do update` makes this statement
-- itself idempotent (re-running it is harmless and simply re-asserts
-- the same configuration), but it is still a live production write,
-- not a draft awaiting review.
--
-- WHY THIS IS ITS OWN FILE/TRANSACTION (Repo Reconciliation pass,
-- 2026-09-23): the original combined migration ran the Core work
-- (postcard_versions columns, Admin RPCs, Keepsakes) AND this bucket
-- insert AND the storage.objects policies below it (docs/sql/2026-09-
-- 21-postcard-artwork-policies.sql) as ONE explicit begin/commit
-- transaction. Applied against live Supabase, that single transaction
-- failed with:
--
--   ERROR 40P01: deadlock detected
--
-- independently identified as a lock-order conflict between relation
-- 17296 (storage.buckets) and relation 17306 (storage.objects) —
-- Supabase Storage's own internal management appears to lock those two
-- relations in an order this migration's single-transaction bucket-
-- then-policy sequence could collide with. Because it was one
-- transaction, the ENTIRE migration rolled back (confirmed via a read-
-- only rollback check: zero snapshot columns, zero Phase 2A-2 RPCs, no
-- postcard-artwork bucket, no policies, original data untouched).
--
-- The fix: split into three independently-committing transactions.
-- THIS file is transaction 2 of 3 — the bucket insert/configuration
-- ONLY, isolated from both the Core transaction (1, already committed
-- separately) and the storage.objects policy creation (3, its own
-- file, applied after this one). Isolating the bucket write from the
-- policy writes is exactly what avoids the lock-order collision that
-- caused the original deadlock.
--
-- Applied successfully: 0 rows returned. Independent bucket verifier
-- (checking storage.buckets directly): PASS. See docs/sql/2026-09-21-
-- postcard-admin-and-keepsakes-verify.sql for the current combined
-- verifier covering this bucket's final live state alongside
-- everything else.
--
-- ------------------------------------------------------------
-- EXECUTABLE INTENT (unchanged from the original combined migration's
-- own Part C — only the file boundary and transaction isolation
-- changed, never the statement itself):
--
-- Genuinely public (bucket-level `public = true`) — TEMPA-owned
-- catalogue artwork is not private correspondence media, and this
-- matches the EXISTING public/postcards/ static assets' own access
-- characteristics exactly (anyone with the URL can already view
-- essaouira.jpg with zero auth, since Next.js serves public/
-- unconditionally) — this bucket doesn't weaken anything, it just
-- gives Admin a second, equally-public place to add MORE artwork
-- without a code deploy. Writes are admin-only (enforced by the
-- policies in the companion file, docs/sql/2026-09-21-postcard-
-- artwork-policies.sql — this file only creates/configures the bucket
-- row itself, no policy DDL).
-- ============================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('postcard-artwork', 'postcard-artwork', true, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

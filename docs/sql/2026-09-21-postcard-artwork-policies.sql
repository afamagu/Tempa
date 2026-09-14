-- ============================================================
-- TEMPA — POSTCARD-ARTWORK STORAGE POLICIES (ADMIN PHASE 2A-2, PART 3/3)
-- ============================================================
-- STATUS: LIVE. Manually applied AFTER docs/sql/2026-09-21-postcard-
-- artwork-bucket.sql (transaction 2 of 3) succeeded, which itself
-- followed docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql (the
-- Core transaction, 1 of 3). Do not rerun casually — `create policy`
-- errors if a policy with the same name already exists; this file is a
-- historical record of what shipped, not a script meant for repeat
-- execution against a database where it has already run.
--
-- WHY THIS IS ITS OWN FILE/TRANSACTION (Repo Reconciliation pass,
-- 2026-09-23): see docs/sql/2026-09-21-postcard-artwork-bucket.sql's
-- own header for the full deadlock history — the original combined
-- migration ran the bucket insert and these two storage.objects
-- policies in the SAME transaction as each other (and as the Core
-- work), which deadlocked live (ERROR 40P01, relation 17296
-- storage.buckets vs. relation 17306 storage.objects) and rolled back
-- entirely. Splitting the bucket write and the policy writes into
-- separate, independently-committing transactions — this file being
-- the LAST of the three, applied only once the bucket itself was
-- confirmed to exist — is what avoids that lock-order collision.
--
-- Applied successfully: 0 rows returned. Independent policies verifier:
-- PASS. Final combined live verification across all three transactions
-- (docs/sql/2026-09-21-postcard-admin-and-keepsakes-verify.sql): 23/23
-- PASS.
--
-- ------------------------------------------------------------
-- EXECUTABLE INTENT (unchanged from the original combined migration's
-- own Part C — only the file boundary and transaction isolation
-- changed, never the statements themselves):
--
-- postcard_artwork_select — a public bucket already serves objects
-- through Storage's own public endpoint without consulting RLS at all;
-- this policy exists anyway for defense-in-depth and for any code path
-- that lists/reads storage.objects through the ordinary Postgres API
-- rather than the public CDN URL.
--
-- postcard_artwork_insert — admin-only writes. No per-uploader folder
-- scoping needed (unlike letter-photos/dispatch-photos/announcement-
-- images, which key by the uploading member's own id): this bucket has
-- exactly one class of writer, is_staff('admin'), never an ordinary
-- member.
--
-- Grants/posture (intended and, per the final live verifier, actually
-- in effect): SELECT on this bucket's objects to any authenticated
-- member (redundant with the bucket's own public-read posture, kept
-- for the reason above); INSERT restricted to is_staff('admin') only;
-- no UPDATE/DELETE policy at all — same accepted-orphan posture as
-- announcement-images/dispatch-photos/letter-photos: replacing artwork
-- uploads a new object and creates a new postcard_versions row (see
-- the Core transaction's admin_create_postcard_version); an old object
-- some version still references is never touched, and an unattached
-- upload that never became a version is a harmless orphan.
-- ============================================================

begin;

create policy postcard_artwork_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'postcard-artwork');

create policy postcard_artwork_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'postcard-artwork'
    and public.is_staff('admin')
  );

commit;

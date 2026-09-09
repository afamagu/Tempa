-- Tempa — Search Migration 1: letter-body full-text index.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Adds ONLY the storage/index for full-text search over letters.body.
-- No RPC, no application code, no change to letters_for_participant —
-- all deferred to a later migration by design.
--
-- Checked for collisions first: no column or index named body_search /
-- letters_body_search_idx exists anywhere in this project's migration
-- history. Current indexes on letters are letters_recipient_status_idx,
-- letters_sender_idx, letters_reply_to_idx, letters_expiry_scan_idx
-- (letters_one_first_contact_per_pair and letters_one_reply_per_original
-- were both already dropped by earlier migrations) — nothing here
-- conflicts.
--
-- Expression choice: to_tsvector(regconfig, text) — the TWO-argument
-- form with a literal config — is IMMUTABLE, which GENERATED ALWAYS AS
-- requires. The single-argument to_tsvector(text) reads the session's
-- default_text_search_config GUC and is only STABLE; Postgres rejects
-- STABLE expressions in a generated column outright ("generation
-- expression is not immutable"). 'simple'::regconfig is a literal
-- constant, not a GUC lookup, so this is the correct, standard pattern
-- — not something novel to this migration. coalesce(body, '') is
-- defensive only: body is already NOT NULL, so this never actually
-- fires today, but it keeps the expression safe if that constraint
-- ever changes later.
--
-- letters.body is immutable after creation (enforce_letter_immutability
-- trigger, unrelated to this migration, still in force) — so this
-- STORED column, once computed, never needs recomputation for an
-- existing row. It is computed for every existing row automatically as
-- part of this ALTER TABLE — there is no separate backfill step, and
-- none should ever be added.

begin;

alter table public.letters
  add column body_search tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(body, ''))) stored;

comment on column public.letters.body_search is
  'Generated, stored tsvector over letters.body using the simple text-search configuration (deliberately not english — Tempa correspondence is international, and english''s stemming/stop-word removal is English-specific and would degrade non-English letters). Computed once at insert; body is immutable so this never needs recomputation. Populated for search_letterbox (a later migration) — do not query this from application code directly.';

create index letters_body_search_idx
  on public.letters
  using gin (body_search);

commit;

-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip)
-- ============================================================

-- 1. body_search exists, and is a generated/stored column.
select
  column_name,
  data_type,
  is_generated,
  generation_expression
from information_schema.columns
where table_schema = 'public'
  and table_name = 'letters'
  and column_name = 'body_search';
-- expect one row: is_generated = 'ALWAYS', generation_expression
-- showing the to_tsvector(...) expression above. (Postgres does not
-- implement VIRTUAL generated columns as of this version — 'ALWAYS'
-- here already means stored-on-disk, not merely computed-on-read.)

-- 2. The GIN index exists.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'letters'
  and indexname = 'letters_body_search_idx';
-- expect one row, indexdef containing "USING gin (body_search)".

-- 3. Existing letters have populated vectors — no row was skipped or
--    left null by the ALTER TABLE's automatic backfill.
select
  count(*) as total_letters,
  count(*) filter (where body_search is not null) as populated,
  count(*) filter (where body_search is null) as null_vectors
from public.letters;
-- expect populated = total_letters, null_vectors = 0.

-- 4a. A real search against existing data, using the index. Replace
--     'REPLACE_WITH_KNOWN_WORD' with an actual word you know appears
--     in at least one existing letter body (e.g. a distinctive word
--     from one of the live-test letters).
select
  l.id,
  l.correspondence_id,
  ts_rank(l.body_search, q.query) as rank,
  left(l.body, 80) as body_preview
from public.letters l, websearch_to_tsquery('simple', 'REPLACE_WITH_KNOWN_WORD') q(query)
where l.body_search @@ q.query
order by rank desc
limit 5;

-- 4b. Same query, via EXPLAIN, to directly confirm the planner is
--     actually using letters_body_search_idx (look for "Bitmap Index
--     Scan on letters_body_search_idx" in the output) rather than a
--     sequential scan.
explain analyze
select l.id
from public.letters l, websearch_to_tsquery('simple', 'REPLACE_WITH_KNOWN_WORD') q(query)
where l.body_search @@ q.query;

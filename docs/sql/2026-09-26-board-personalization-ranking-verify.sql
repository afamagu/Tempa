-- ============================================================
-- TEMPA — BOARD PERSONALIZATION / RELATIONSHIP-AWARE RANKING
-- READ-ONLY VERIFICATION
-- Run AFTER docs/sql/2026-09-26-board-personalization-ranking.sql has
-- been applied. Every statement below is a SELECT/has_*_privilege
-- check — no mutation of any kind.
-- ============================================================
-- STATUS: NOT YET RUN LIVE (this checkpoint is implementation + local
-- verification only — see the migration file's own STATUS line).
--
-- Predicates are written to tolerate PostgreSQL's own normalization of
-- stored expressions (pg_get_functiondef/pg_get_expr re-deparse from the
-- parsed representation, not the original literal formatting), matching
-- the convention established in docs/sql/2026-09-22-board-feed-
-- foundation-verify.sql's own "Preflight correction" notes: prefer
-- ILIKE substring checks over exact-source matching wherever formatting
-- could plausibly shift, and prefer structural catalog checks (exact
-- signature via to_regprocedure, RETURNS TABLE shape, grants) over text
-- scanning wherever a structural check is available instead.
-- ============================================================

with
-- Exact-signature checks — the new 7-arg signature (smallint/numeric
-- cursor types) must exist; the OLD 7-arg signature (integer/bigint
-- cursor types) must be gone, proving the DROP FUNCTION actually ran
-- rather than merely adding a second overload alongside the old one.
signature_check as (
  select
    to_regprocedure(
      'public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)'
    ) is not null as new_signature_exists,
    to_regprocedure(
      'public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid)'
    ) is null as old_signature_removed
),

-- RETURNS TABLE shape — the minimal-exposure contract: is_kept/
-- is_familiar booleans present, no `familiarity` column, no `tier`/
-- `author_seq` column (the old shape), rank_key present as numeric,
-- seen_bucket present. pg_get_function_result deparses the RETURNS
-- TABLE clause as declared, independent of the function body's own
-- comments/formatting — a structural check, not a text scan.
return_shape_check as (
  select
    pg_get_function_result(p.oid) as result_text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'board_feed_page'
    and p.oid = to_regprocedure(
      'public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)'
    )
),

-- Core function properties: SECURITY INVOKER, STABLE, fixed search_path,
-- grants. STABLE is provolatile = 's' in pg_proc.
board_feed_page_props as (
  select
    p.oid is not null as exists_at_all,
    not p.prosecdef as is_security_invoker,
    p.provolatile = 's' as is_stable,
    exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
      where cfg ilike 'search_path=public'
    ) as fixed_search_path,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    pg_get_functiondef(p.oid) as fn_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'board_feed_page'
    and p.oid = to_regprocedure(
      'public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)'
    )
),

-- Precisely-bounded CTE-body extraction. Originally added to replace
-- three regex predicates PostgreSQL's regex engine rejected live with
-- "ERROR 2201B: invalid regular expression: invalid repetition
-- count(s)" (a `{m,n}` repetition bound over its 255/RE_DUP_MAX cap).
--
-- LIVE-DIAGNOSTIC FOLLOW-UP #2: the corrected (regex-free) verifier then
-- ran live and returned overall_pass=false on exactly two predicates —
-- has_author_diversity_mechanism and final_order_matches_contract — both
-- confirmed, by direct inspection of the unmodified, live-applied
-- migration file, to be VERIFIER false negatives, never a defect in the
-- migration itself. Root cause: those two predicates each required one
-- long, UNBROKEN literal chunk spanning a window function's OVER/
-- PARTITION BY clause and a multi-column ORDER BY clause respectively —
-- exactly the two SQL constructs PostgreSQL's own function-body
-- reparsing (prosqlbody, since PG14) is most likely to re-lay-out with
-- its own internal whitespace/newlines when pg_get_functiondef
-- reconstructs the function definition, unlike the many shorter/
-- simpler literal checks elsewhere in this file (single tokens, short
-- numeric expressions) that survived unchanged. The fix is the SAME
-- discipline already applied above: bound a small, unambiguous region
-- via single-token markers (never a marker containing internal
-- whitespace), then prove structure via independent short ILIKE checks
-- plus position()-based ORDER checks — never one long adjacent literal
-- that a pretty-printer's own line-wrapping could silently break.
cte_bodies as (
  select
    substring(
      p.fn_def
      from position('familiar_authors as (' in p.fn_def)
      for greatest(
        position('familiar_augment as (' in p.fn_def) - position('familiar_authors as (' in p.fn_def),
        0
      )
    ) as familiar_authors_body,
    substring(
      p.fn_def
      from position('classified as (' in p.fn_def)
      for greatest(
        position('author_diverse as (' in p.fn_def) - position('classified as (' in p.fn_def),
        0
      )
    ) as classified_body,
    substring(
      p.fn_def
      from position('author_diverse as (' in p.fn_def)
      for greatest(
        position('keep_ranked as (' in p.fn_def) - position('author_diverse as (' in p.fn_def),
        0
      )
    ) as author_diverse_body,
    substring(
      p.fn_def
      from position('keep_ranked as (' in p.fn_def)
      for greatest(
        position('familiar_merged as (' in p.fn_def) - position('keep_ranked as (' in p.fn_def),
        0
      )
    ) as diversity_downstream_body,
    -- Open-ended (no FOR length) — 'final as (' marks the start of the
    -- LAST named CTE, so everything from there to the end of fn_def is
    -- exactly the final CTE plus the trailing outer SELECT/WHERE/ORDER
    -- BY/LIMIT, with nothing meaningful after it but the closing $$.
    substring(
      p.fn_def
      from position('final as (' in p.fn_def)
    ) as final_region
  from board_feed_page_props p
),

-- final_region (above) still mixes the outer SELECT's own column list
-- (which lists f.id BEFORE f.seen_bucket, an unrelated ordering that
-- would contaminate a naive position() comparison) with the WHERE
-- clause's cursor-tuple comparison and the trailing ORDER BY clause.
-- Splitting it into exactly those two further-bounded pieces — via the
-- single-token markers 'where'/'order by' rather than any long literal
-- — isolates the cursor tuple (proof A) from the ORDER BY sequence
-- (proof B) as two SEPARATE, independently-checkable regions.
final_regions as (
  select
    fr.final_region,
    substring(
      fr.final_region
      from position('where' in fr.final_region)
      for greatest(
        position('order by' in fr.final_region) - position('where' in fr.final_region),
        0
      )
    ) as where_tuple_region,
    substring(
      fr.final_region
      from position('order by' in fr.final_region)
    ) as order_by_region
  from cte_bodies fr
),

-- Text-scan checks against the function's own source (fn_def) — every
-- one of these is a structural/algorithmic property that has no cleaner
-- catalog-level check available, mirroring the precedent verifier's own
-- board_feed_page_check block. The three correspondent/seen_bucket
-- checks below read from cte_bodies (plain ILIKE / position() ordering
-- — no regex) rather than fn_def directly, per the note above.
algorithm_check as (
  select
    fn_def ilike '%status = ''published''%' as filters_published,
    fn_def ilike '%moderation_status = ''visible''%' as filters_moderation_visible,
    fn_def ilike '%published_at <= p_session_started_at%' as enforces_publish_cutoff,
    fn_def ilike '%first_viewed_at%' and fn_def ilike '%p_session_started_at%' as uses_session_stable_unseen_signal,
    not (fn_def ilike '%dv.viewed_at < p_session_started_at%') as never_uses_mutable_viewed_at,
    fn_def ilike '%kept_minds%' and fn_def ilike '%km.created_at < p_session_started_at%' as has_keep_signal,
    cb.familiar_authors_body ilike '%public.correspondences%' as correspondent_references_correspondences_table,
    cb.familiar_authors_body ilike '%status = ''active''%' as correspondent_requires_active_status,
    cb.familiar_authors_body ilike '%established_at is not null%' as correspondent_requires_established_at,
    fn_def ilike '%established_at < p_session_started_at%' as correspondent_signal_session_stable,
    not (fn_def ilike '%is_correspondence_blocked_pair%') as never_uses_stop_letters_helper,
    fn_def ilike '%is_blocked_pair%' as uses_full_block_helper,
    fn_def ilike '%limit 300%' as global_pool_bounded_to_300,
    fn_def ilike '%cross join lateral%' as uses_lateral_augmentation,
    fn_def ilike '%limit 2%' as augmentation_bounded_to_two_per_author,
    not (fn_def ilike '%random()%') as never_uses_random,
    fn_def ilike '%hashtext(%' as uses_seeded_hash,
    -- Author diversity — LIVE-DIAGNOSTIC FOLLOW-UP #2: the single long
    -- literal chunk this used to require ('row_number() over (partition
    -- by' immediately adjacent, no internal wildcard tolerance for the
    -- clause's own internal layout) is exactly the kind of window-
    -- function syntax PostgreSQL's own function-body reparsing can
    -- re-lay-out with different internal whitespace when reconstructing
    -- fn_def, producing a false negative against a genuinely-correct
    -- migration. Replaced with independent, short, single-token checks
    -- against the precisely-bounded author_diverse_body — proving
    -- row_number() is used, that its PARTITION BY clause specifically
    -- (isolated from the window's own trailing ORDER BY) contains BOTH
    -- seen_bucket and author_id, and that the result is bound to
    -- author_seq — plus a separate check that author_seq is genuinely
    -- consumed downstream (keep_ranked/second_signal_ranked), never
    -- computed and discarded.
    cb.author_diverse_body ilike '%row_number()%' as author_diverse_uses_row_number,
    cb.author_diverse_body ilike '%partition by%' as author_diverse_has_partition_clause,
    (
      substring(
        cb.author_diverse_body
        from position('partition by' in cb.author_diverse_body)
        for greatest(
          position('order by' in cb.author_diverse_body) - position('partition by' in cb.author_diverse_body),
          0
        )
      ) ilike '%seen_bucket%'
    ) as author_diverse_partitions_by_seen_bucket,
    (
      substring(
        cb.author_diverse_body
        from position('partition by' in cb.author_diverse_body)
        for greatest(
          position('order by' in cb.author_diverse_body) - position('partition by' in cb.author_diverse_body),
          0
        )
      ) ilike '%author_id%'
    ) as author_diverse_partitions_by_author_id,
    cb.author_diverse_body ilike '%as author_seq%' as author_diverse_result_bound_to_author_seq,
    (
      cb.diversity_downstream_body ilike '%author_seq%'
      and cb.diversity_downstream_body ilike '%order by%'
    ) as author_seq_consumed_downstream,
    (
      cb.author_diverse_body ilike '%row_number()%'
      and cb.author_diverse_body ilike '%partition by%'
      and cb.author_diverse_body ilike '%as author_seq%'
      and substring(
        cb.author_diverse_body
        from position('partition by' in cb.author_diverse_body)
        for greatest(
          position('order by' in cb.author_diverse_body) - position('partition by' in cb.author_diverse_body),
          0
        )
      ) ilike '%seen_bucket%'
      and substring(
        cb.author_diverse_body
        from position('partition by' in cb.author_diverse_body)
        for greatest(
          position('order by' in cb.author_diverse_body) - position('partition by' in cb.author_diverse_body),
          0
        )
      ) ilike '%author_id%'
      and cb.diversity_downstream_body ilike '%author_seq%'
      and cb.diversity_downstream_body ilike '%order by%'
    ) as has_author_diversity_mechanism,
    fn_def ilike '%seen_bucket%' as has_seen_bucket,
    (
      cb.classified_body ilike '%then 1::smallint%'
      and cb.classified_body ilike '%else 0::smallint%'
      and position('then 1::smallint' in cb.classified_body) < position('else 0::smallint' in cb.classified_body)
    ) as seen_bucket_is_binary_classification,
    fn_def ilike '%/ 3.0%' as has_keep_weight_three,
    fn_def ilike '%/ 1.0%' as has_second_signal_weight_one,
    (fn_def ilike '%2 * stream_i - 1%' or fn_def ilike '%2 * fr.familiar_i - 1%') as uses_divisor_apportionment_formula,
    -- Final order/cursor contract — LIVE-DIAGNOSTIC FOLLOW-UP #2: same
    -- class of false negative as author diversity above, this time from
    -- requiring the entire multi-column ORDER BY clause as one
    -- unbroken literal. Replaced with two SEPARATELY-bounded regions
    -- (fr.where_tuple_region / fr.order_by_region, each isolated via
    -- single-token markers only) and, within each, independent
    -- existence checks plus a position()-based proof that seen_bucket,
    -- rank_key, seed_hash, and id genuinely appear in THAT exact
    -- sequence — proving both the cursor tuple order (A) and the final
    -- ORDER BY sequence (B) as distinct properties, never merely that
    -- all four words appear somewhere.
    (
      fr.where_tuple_region ilike '%seen_bucket%'
      and fr.where_tuple_region ilike '%rank_key%'
      and fr.where_tuple_region ilike '%seed_hash%'
      and fr.where_tuple_region ilike '%.id%'
      and position('seen_bucket' in fr.where_tuple_region) < position('rank_key' in fr.where_tuple_region)
      and position('rank_key' in fr.where_tuple_region) < position('seed_hash' in fr.where_tuple_region)
      and position('seed_hash' in fr.where_tuple_region) < position('.id' in fr.where_tuple_region)
    ) as cursor_tuple_matches_contract,
    (
      fr.order_by_region ilike '%seen_bucket%'
      and fr.order_by_region ilike '%rank_key%'
      and fr.order_by_region ilike '%seed_hash%'
      and fr.order_by_region ilike '%.id%'
      and position('seen_bucket' in fr.order_by_region) < position('rank_key' in fr.order_by_region)
      and position('rank_key' in fr.order_by_region) < position('seed_hash' in fr.order_by_region)
      and position('seed_hash' in fr.order_by_region) < position('.id' in fr.order_by_region)
    ) as final_order_matches_contract,
    not (fn_def ilike '%interest%') as no_topical_interest_ranking,
    not (fn_def ilike '%embedding%') as no_embeddings,
    not (fn_def ilike '%pgvector%') as no_pgvector,
    fn_def ilike '%limit p_limit%' as respects_caller_limit
  from board_feed_page_props, cte_bodies cb, final_regions fr
),

-- No Interests/embeddings/pgvector scope-creep table was introduced —
-- this migration creates no new relations at all.
no_scope_creep_check as (
  select
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('dispatch_interests', 'interests', 'dispatch_embeddings', 'board_sessions')
    ) as no_new_relations_of_concern
)

select
  sig.new_signature_exists,
  sig.old_signature_removed,
  rs.result_text ilike '%is_kept boolean%' as returns_is_kept,
  rs.result_text ilike '%is_familiar boolean%' as returns_is_familiar,
  rs.result_text ilike '%rank_key numeric%' as returns_rank_key_numeric,
  rs.result_text ilike '%seen_bucket smallint%' as returns_seen_bucket,
  not (rs.result_text ilike '%familiarity%') as never_returns_familiarity_string,
  not (rs.result_text ilike '%tier%') as never_returns_old_tier_column,
  not (rs.result_text ilike '%author_seq%') as never_returns_old_author_seq_column,
  p.exists_at_all,
  p.is_security_invoker,
  p.is_stable,
  p.fixed_search_path,
  p.authenticated_exec,
  p.anon_exec as anon_exec_should_be_false,
  a.filters_published,
  a.filters_moderation_visible,
  a.enforces_publish_cutoff,
  a.uses_session_stable_unseen_signal,
  a.never_uses_mutable_viewed_at,
  a.has_keep_signal,
  a.correspondent_references_correspondences_table,
  a.correspondent_requires_active_status,
  a.correspondent_requires_established_at,
  a.correspondent_signal_session_stable,
  a.never_uses_stop_letters_helper,
  a.uses_full_block_helper,
  a.global_pool_bounded_to_300,
  a.uses_lateral_augmentation,
  a.augmentation_bounded_to_two_per_author,
  a.never_uses_random,
  a.uses_seeded_hash,
  a.author_diverse_uses_row_number,
  a.author_diverse_has_partition_clause,
  a.author_diverse_partitions_by_seen_bucket,
  a.author_diverse_partitions_by_author_id,
  a.author_diverse_result_bound_to_author_seq,
  a.author_seq_consumed_downstream,
  a.has_author_diversity_mechanism,
  a.has_seen_bucket,
  a.seen_bucket_is_binary_classification,
  a.has_keep_weight_three,
  a.has_second_signal_weight_one,
  a.uses_divisor_apportionment_formula,
  a.cursor_tuple_matches_contract,
  a.final_order_matches_contract,
  a.no_topical_interest_ranking,
  a.no_embeddings,
  a.no_pgvector,
  a.respects_caller_limit,
  n.no_new_relations_of_concern,
  (
    sig.new_signature_exists and sig.old_signature_removed
    and rs.result_text ilike '%is_kept boolean%' and rs.result_text ilike '%is_familiar boolean%'
    and rs.result_text ilike '%rank_key numeric%' and rs.result_text ilike '%seen_bucket smallint%'
    and not (rs.result_text ilike '%familiarity%')
    and not (rs.result_text ilike '%tier%')
    and not (rs.result_text ilike '%author_seq%')
    and p.exists_at_all and p.is_security_invoker and p.is_stable and p.fixed_search_path
    and p.authenticated_exec and not p.anon_exec
    and a.filters_published and a.filters_moderation_visible and a.enforces_publish_cutoff
    and a.uses_session_stable_unseen_signal and a.never_uses_mutable_viewed_at
    and a.has_keep_signal and a.correspondent_references_correspondences_table
    and a.correspondent_requires_active_status
    and a.correspondent_requires_established_at and a.correspondent_signal_session_stable
    and a.never_uses_stop_letters_helper and a.uses_full_block_helper
    and a.global_pool_bounded_to_300 and a.uses_lateral_augmentation
    and a.augmentation_bounded_to_two_per_author and a.never_uses_random and a.uses_seeded_hash
    and a.author_diverse_uses_row_number and a.author_diverse_has_partition_clause
    and a.author_diverse_partitions_by_seen_bucket and a.author_diverse_partitions_by_author_id
    and a.author_diverse_result_bound_to_author_seq and a.author_seq_consumed_downstream
    and a.has_author_diversity_mechanism and a.has_seen_bucket and a.seen_bucket_is_binary_classification
    and a.has_keep_weight_three and a.has_second_signal_weight_one and a.uses_divisor_apportionment_formula
    and a.cursor_tuple_matches_contract and a.final_order_matches_contract
    and a.no_topical_interest_ranking and a.no_embeddings and a.no_pgvector
    and a.respects_caller_limit
    and n.no_new_relations_of_concern
  ) as overall_pass
from signature_check sig, return_shape_check rs, board_feed_page_props p,
     algorithm_check a, no_scope_creep_check n;


-- ============================================================
-- DETAIL — full source, for manual reading alongside the migration file.
-- ============================================================
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'board_feed_page'
  and p.oid = to_regprocedure(
    'public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)'
  );

-- Confirms the pre-existing index this migration deliberately reuses
-- (no new index added) is genuinely still present with the expected
-- shape.
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'dispatches' and indexname = 'dispatches_author_published_idx';

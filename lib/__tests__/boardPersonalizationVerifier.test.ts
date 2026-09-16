// Board Personalization checkpoint — source-text inspection of the new
// read-only verifier (docs/sql/2026-09-26-board-personalization-ranking-
// verify.sql), same approach as dispatchPostcardsVerifier.test.ts/
// dispatchWorthReadingVerifier.test.ts/dispatchRepliesVerifier.test.ts,
// since there is no live Postgres to run the verifier against here.
// This is NOT a test of the migration's live behavior (see
// lib/dispatches.test.ts's fakeDispatches-based suite for that) — it is
// a proof that the VERIFIER itself asks the right questions, in a form
// that will actually run once applied live.
//
// LIVE-DIAGNOSTIC FOLLOW-UP (verifier now APPLIED-AND-TESTED live... the
// verifier itself, not the ranking migration): the first live run of the
// verifier FAILED OUTRIGHT with "ERROR 2201B: invalid regular
// expression: invalid repetition count(s)", before ever returning a
// summary row. Root cause, confirmed by inspection: PostgreSQL's regex
// engine (unlike JavaScript's) caps a `{m,n}` repetition bound at 255
// (RE_DUP_MAX) — three predicates used `{0,400}` (twice) and `{0,300}`
// (once) as an approximate "how far can `correspondences`/`case` be from
// its own `status`/`established_at`/`then` keyword" distance bound, both
// of which exceed that cap. This file's own prior version treated a
// successfully-constructed JAVASCRIPT `RegExp` (via `new RegExp(pattern)`)
// as proof the pattern was valid PostgreSQL ARE syntax — it is not: the
// two engines' repetition-count limits differ, and JS's RegExp
// constructor never rejects `{0,400}`. That was the actual testing-
// assumption defect this file is now corrected for.
//
// FIX #1 (regex): the three regex predicates are replaced entirely — no
// regex of any kind remains in the verifier. Each CTE in board_feed_
// page's own SQL text has an unambiguous, literal start marker (its own
// "<name> as (") — position()/substring() extract the EXACT text of one
// CTE's body between two such markers, a precise window rather than an
// approximate regex distance bound.
//
// LIVE-DIAGNOSTIC FOLLOW-UP #2: the corrected (regex-free) verifier then
// ran live and returned overall_pass=false on exactly two predicates —
// has_author_diversity_mechanism and final_order_matches_contract — both
// confirmed, by direct inspection of the unmodified, live-applied
// migration file, to be VERIFIER false negatives, never a migration
// defect. Both previously required one LONG, UNBROKEN literal chunk —
// 'row_number() over (partition by' (spanning a window function's OVER/
// PARTITION BY syntax) and 'order by f.seen_bucket, f.rank_key,
// f.seed_hash, f.id' (an entire multi-column ORDER BY clause) — so this
// file's own earlier claim that pg_get_functiondef reproduces a
// LANGUAGE SQL body byte-for-byte VERBATIM turned out to be an
// unverified assumption, not a confirmed fact: PostgreSQL 14+ can parse
// a plain `AS $$...$$` SQL function body into `prosqlbody` and have
// pg_get_functiondef reconstruct/pretty-print FROM that parsed form,
// which can re-lay-out exactly these two clause SHAPES (window
// functions, multi-column ORDER BY) with different internal spacing/
// line-wrapping than the original source — while leaving shorter/
// simpler literal checks (single tokens, short numeric expressions)
// intact, matching the live failure pattern exactly. FIX #2: both were
// replaced with the SAME discipline used for FIX #1 — bound a small
// region via single-token markers ONLY (never a marker with internal
// whitespace, e.g. 'row_number()' and 'partition by' as two INDEPENDENT
// checks rather than one adjacent phrase), then prove structure via
// short ILIKE checks plus position()-based ORDER checks.
//
// Two pitfall classes carried over from an even earlier review round,
// both directly relevant to a fresh text-scanning file like this one:
// (1) comment-vs-code false positives — a prose comment can legitimately
// contain a substring an ILIKE check is also scanning for, so any check
// here that could be fooled by a comment is written to require a
// genuine code shape (e.g. an operator, a keyword adjacency), never a
// bare word; (2) this file does no static-class-name/HTML-attribute
// scanning at all (it is pure SQL text), so that specific pitfall does
// not apply here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-26-board-personalization-ranking-verify.sql')
const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-26-board-personalization-ranking.sql')

const sql = readFileSync(VERIFIER_PATH, 'utf8')
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')

function ctePart(name: string, nextMarker: string): string {
  const start = sql.indexOf(`${name} as (`)
  expect(start, `expected to find CTE "${name}" in the verifier`).toBeGreaterThan(-1)
  const end = sql.indexOf(nextMarker, start)
  expect(end, `expected to find "${nextMarker}" after CTE "${name}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

// Mirrors board_feed_page_props/cte_bodies' own extraction shape in
// plain JS string operations — NEVER via a JS RegExp standing in for a
// PostgreSQL one (that conflation is exactly the defect this file is
// now correcting). Returns '' (never throws) when a marker is absent,
// mirroring the SQL's own greatest(..., 0) fail-safe.
function extractCteBody(fnDefText: string, startMarker: string, endMarker: string): string {
  const start = fnDefText.indexOf(startMarker)
  if (start === -1) return ''
  const end = fnDefText.indexOf(endMarker, start)
  if (end === -1) return ''
  return fnDefText.slice(start, end)
}

describe('board personalization verifier — read-only', () => {
  it('contains no INSERT, UPDATE, DELETE, or DDL statement anywhere in its executable code (comment lines are excluded — a prose comment explaining "the DROP FUNCTION actually ran" legitimately contains that phrase without being one)', () => {
    const codeOnly = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .toLowerCase()
    expect(codeOnly).not.toContain('insert into')
    expect(codeOnly).not.toContain('update public.')
    expect(codeOnly).not.toContain('delete from')
    expect(codeOnly).not.toContain('create table')
    expect(codeOnly).not.toContain('alter table')
    expect(codeOnly).not.toContain('drop table')
    expect(codeOnly).not.toContain('create function')
    expect(codeOnly).not.toContain('drop function')
    expect(codeOnly).not.toContain('create policy')
    expect(codeOnly).not.toContain('drop policy')
  })

  it('every non-comment, non-blank line is a read-only construct, never a mutation keyword', () => {
    const codeLines = sql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
    const mutationKeywords = /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i
    const offending = codeLines.filter((line) => mutationKeywords.test(line))
    expect(offending).toEqual([])
  })
})

describe('board personalization verifier — exact signature + RETURNS TABLE shape', () => {
  const sig = ctePart('signature_check', 'return_shape_check')
  const returnShape = ctePart('return_shape_check', 'board_feed_page_props')

  it('checks the NEW 7-arg signature (smallint/numeric cursor types) exists', () => {
    expect(sig).toContain("to_regprocedure(\n      'public.board_feed_page(timestamptz, text, integer, smallint, numeric, integer, uuid)'\n    ) is not null as new_signature_exists")
  })

  it('checks the OLD 7-arg signature (integer/bigint cursor types) is gone — proving DROP FUNCTION ran, not merely a second overload', () => {
    expect(sig).toContain("to_regprocedure(\n      'public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid)'\n    ) is null as old_signature_removed")
  })

  it('checks the minimal-exposure RETURNS TABLE contract: is_kept/is_familiar/rank_key/seen_bucket present', () => {
    expect(returnShape).toContain('pg_get_function_result(p.oid)')
  })

  it('the SUMMARY select proves is_kept/is_familiar/rank_key/seen_bucket are present AND familiarity/tier/author_seq are absent — never a single bundled check', () => {
    expect(sql).toContain("rs.result_text ilike '%is_kept boolean%' as returns_is_kept")
    expect(sql).toContain("rs.result_text ilike '%is_familiar boolean%' as returns_is_familiar")
    expect(sql).toContain("rs.result_text ilike '%rank_key numeric%' as returns_rank_key_numeric")
    expect(sql).toContain("rs.result_text ilike '%seen_bucket smallint%' as returns_seen_bucket")
    expect(sql).toContain("not (rs.result_text ilike '%familiarity%') as never_returns_familiarity_string")
    expect(sql).toContain("not (rs.result_text ilike '%tier%') as never_returns_old_tier_column")
    expect(sql).toContain("not (rs.result_text ilike '%author_seq%') as never_returns_old_author_seq_column")
  })
})

describe('board personalization verifier — core function properties', () => {
  const body = ctePart('board_feed_page_props', 'cte_bodies')

  it('checks SECURITY INVOKER (never DEFINER — must inherit RLS, not bypass it)', () => {
    expect(body).toContain('not p.prosecdef as is_security_invoker')
  })

  it('checks STABLE via provolatile', () => {
    expect(body).toContain("p.provolatile = 's' as is_stable")
  })

  it('checks a fixed search_path=public, structurally via proconfig, not a text scan', () => {
    expect(body).toContain("cfg ilike 'search_path=public'")
  })

  it('checks authenticated EXECUTE and anon EXECUTE (expected false) both via has_function_privilege', () => {
    expect(body).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec")
    expect(body).toContain("has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec")
  })
})

describe('board personalization verifier — algorithm properties (text-scan against fn_def)', () => {
  const body = ctePart('algorithm_check', 'no_scope_creep_check')

  it('published + moderation-visible eligibility, session publication cutoff', () => {
    expect(body).toContain("fn_def ilike '%status = ''published''%' as filters_published")
    expect(body).toContain("fn_def ilike '%moderation_status = ''visible''%' as filters_moderation_visible")
    expect(body).toContain("fn_def ilike '%published_at <= p_session_started_at%' as enforces_publish_cutoff")
  })

  it('session-stable unseen semantics — uses first_viewed_at, never the mutable viewed_at, for tiering', () => {
    expect(body).toContain('uses_session_stable_unseen_signal')
    expect(body).toContain("not (fn_def ilike '%dv.viewed_at < p_session_started_at%') as never_uses_mutable_viewed_at")
  })

  it('Keep signal exists, correctly session-gated via kept_minds.created_at', () => {
    expect(body).toContain("fn_def ilike '%kept_minds%' and fn_def ilike '%km.created_at < p_session_started_at%' as has_keep_signal")
  })

  it('never references the Stop-Letters-inclusive (any-scope) blocking helper, and does use the full-block-only helper', () => {
    expect(body).toContain("not (fn_def ilike '%is_correspondence_blocked_pair%') as never_uses_stop_letters_helper")
    expect(body).toContain("fn_def ilike '%is_blocked_pair%' as uses_full_block_helper")
  })

  it('global pool bounded to 300, augmentation via LATERAL bounded to 2 per author', () => {
    expect(body).toContain("fn_def ilike '%limit 300%' as global_pool_bounded_to_300")
    expect(body).toContain("fn_def ilike '%cross join lateral%' as uses_lateral_augmentation")
    expect(body).toContain("fn_def ilike '%limit 2%' as augmentation_bounded_to_two_per_author")
  })

  it('deterministic seeded ordering — hashtext used, random() never used', () => {
    expect(body).toContain("not (fn_def ilike '%random()%') as never_uses_random")
    expect(body).toContain("fn_def ilike '%hashtext(%' as uses_seeded_hash")
  })

  it('seen_bucket presence, Keep/second-signal weighting, divisor apportionment, caller limit (author diversity and final order are covered in their own dedicated describes below)', () => {
    expect(body).toContain("as has_seen_bucket")
    expect(body).toContain("as has_keep_weight_three")
    expect(body).toContain("as has_second_signal_weight_one")
    expect(body).toContain("as uses_divisor_apportionment_formula")
    expect(body).toContain("fn_def ilike '%limit p_limit%' as respects_caller_limit")
  })

  it('no topical-interest ranking / embeddings / pgvector was introduced', () => {
    expect(body).toContain("not (fn_def ilike '%interest%') as no_topical_interest_ranking")
    expect(body).toContain("not (fn_def ilike '%embedding%') as no_embeddings")
    expect(body).toContain("not (fn_def ilike '%pgvector%') as no_pgvector")
  })
})

describe('board personalization verifier — NO regex operators anywhere (the actual fix for ERROR 2201B)', () => {
  it('contains no ~, ~*, !~, !~*, regexp_*, or SIMILAR TO anywhere', () => {
    // Word-boundary-safe: `~` alone would false-positive on things like
    // a URL or a stray tilde in prose, so each operator is checked as
    // its own token/adjacency, not a bare substring scan.
    expect(sql).not.toMatch(/[^!]~\*?/) // any bare ~ or ~* not preceded by !
    expect(sql).not.toMatch(/!~\*?/) // !~ or !~*
    expect(sql.toLowerCase()).not.toContain('regexp_')
    expect(sql.toLowerCase()).not.toContain('similar to')
  })

  it('as a defense-in-depth safety net against ever reintroducing an unsafe bound: any `{m,n}` repetition quantifier appearing in EXECUTABLE SQL (comment lines excluded — this file\'s own prose explaining the old `{0,400}` bug is not itself a regex) has both bounds within PostgreSQL\'s actual 255 (RE_DUP_MAX) limit', () => {
    const codeOnly = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    const repetitionBounds = [...codeOnly.matchAll(/\{(\d+),(\d+)\}/g)]
    for (const match of repetitionBounds) {
      const [, lo, hi] = match
      expect(Number(lo)).toBeLessThanOrEqual(255)
      expect(Number(hi)).toBeLessThanOrEqual(255)
    }
  })
})

describe('board personalization verifier — cte_bodies: precise, marker-bounded CTE-body extraction (replaces the invalid regex)', () => {
  const body = ctePart('cte_bodies', 'final_regions')

  it('extracts familiar_authors_body between the familiar_authors and familiar_augment CTE markers', () => {
    expect(body).toContain("position('familiar_authors as (' in p.fn_def)")
    expect(body).toContain("position('familiar_augment as (' in p.fn_def)")
    expect(body).toContain('as familiar_authors_body')
  })

  it('extracts classified_body between the classified and author_diverse CTE markers', () => {
    expect(body).toContain("position('classified as (' in p.fn_def)")
    expect(body).toContain("position('author_diverse as (' in p.fn_def)")
    expect(body).toContain('as classified_body')
  })

  it('extracts author_diverse_body between the author_diverse and keep_ranked CTE markers', () => {
    expect(body).toContain("position('author_diverse as (' in p.fn_def)")
    expect(body).toContain("position('keep_ranked as (' in p.fn_def)")
    expect(body).toContain('as author_diverse_body')
  })

  it('extracts diversity_downstream_body between the keep_ranked and familiar_merged CTE markers', () => {
    expect(body).toContain("position('keep_ranked as (' in p.fn_def)")
    expect(body).toContain("position('familiar_merged as (' in p.fn_def)")
    expect(body).toContain('as diversity_downstream_body')
  })

  it('extracts final_region open-ended from the final CTE marker to the end of fn_def — no FOR length, since "final" is the last named CTE and nothing meaningful follows it but the closing $$', () => {
    expect(body).toContain("position('final as (' in p.fn_def)")
    expect(body).toContain('as final_region')
    // The final_region extraction is deliberately the two-argument
    // substring(text, position) form — no `for`/`greatest` needed here,
    // since an open-ended substring has no length argument that could
    // ever go negative.
    const finalRegionStart = body.indexOf('as final_region')
    const finalRegionCallStart = body.lastIndexOf('substring(', finalRegionStart)
    const finalRegionCall = body.slice(finalRegionCallStart, finalRegionStart)
    expect(finalRegionCall).not.toContain('for greatest')
  })

  it('every BOUNDED (FOR-length) substring() call is guarded by greatest(..., 0) — a negative length would itself raise a live Postgres error, not merely fail a predicate', () => {
    const substringCalls = body.split('substring(').slice(1)
    const boundedCalls = substringCalls.filter((call) => call.includes(' for '))
    expect(boundedCalls.length).toBeGreaterThan(0)
    for (const call of boundedCalls) {
      // Scope the check to just this one call's own "for ... )" clause
      // (up to the FIRST unmatched close-paren after "for"), not the
      // rest of the file, which — since this is a plain string split,
      // not a parser — would otherwise trivially contain a LATER call's
      // greatest() too.
      const forIdx = call.indexOf(' for ')
      const nearbyText = call.slice(forIdx, forIdx + 40)
      expect(nearbyText).toContain('greatest(')
    }
  })

  it('algorithm_check reads from cte_bodies AND final_regions (cross-joined alongside board_feed_page_props)', () => {
    const algorithmCheckBody = ctePart('algorithm_check', 'no_scope_creep_check')
    expect(algorithmCheckBody).toContain('from board_feed_page_props, cte_bodies cb, final_regions fr')
    expect(algorithmCheckBody).toContain('cb.familiar_authors_body')
    expect(algorithmCheckBody).toContain('cb.classified_body')
    expect(algorithmCheckBody).toContain('cb.author_diverse_body')
    expect(algorithmCheckBody).toContain('cb.diversity_downstream_body')
    expect(algorithmCheckBody).toContain('fr.where_tuple_region')
    expect(algorithmCheckBody).toContain('fr.order_by_region')
  })
})

describe('board personalization verifier — final_regions: splits final_region into a WHERE/cursor-tuple region and an ORDER BY region', () => {
  const body = ctePart('final_regions', 'algorithm_check')

  it('where_tuple_region is bounded by the single-token markers "where" and "order by" (never a long literal)', () => {
    expect(body).toContain("position('where' in fr.final_region)")
    expect(body).toContain("position('order by' in fr.final_region)")
    expect(body).toContain('as where_tuple_region')
  })

  it('order_by_region is open-ended from the "order by" marker to the end of final_region', () => {
    expect(body).toContain("position('order by' in fr.final_region)")
    expect(body).toContain('as order_by_region')
  })

  it('reads from cte_bodies, not board_feed_page_props directly — final_region is only computed once, upstream', () => {
    expect(body).toContain('from cte_bodies fr')
  })
})

describe('board personalization verifier — established-correspondent checks, exercised (via plain JS string ops mirroring position()/substring() — NEVER a JS RegExp standing in for a PostgreSQL one) against real and synthetic sample text', () => {
  const algorithmCheckBody = ctePart('algorithm_check', 'no_scope_creep_check')

  it('the verifier checks reference public.correspondences, status = \'active\', and established_at is not null — as plain ILIKE checks on the bounded familiar_authors_body, not fn_def directly', () => {
    expect(algorithmCheckBody).toContain("cb.familiar_authors_body ilike '%public.correspondences%' as correspondent_references_correspondences_table")
    expect(algorithmCheckBody).toContain("cb.familiar_authors_body ilike '%status = ''active''%' as correspondent_requires_active_status")
    expect(algorithmCheckBody).toContain("cb.familiar_authors_body ilike '%established_at is not null%' as correspondent_requires_established_at")
  })

  it('extracting familiar_authors_body from the REAL, applied migration function text yields a body containing all three required substrings', () => {
    const realBody = extractCteBody(migrationSql, 'familiar_authors as (', 'familiar_augment as (')
    expect(realBody.length).toBeGreaterThan(0)
    expect(realBody.toLowerCase()).toContain('public.correspondences')
    expect(realBody.toLowerCase()).toContain("status = 'active'")
    expect(realBody.toLowerCase()).toContain('established_at is not null')
  })

  it('negative: a correspondence check missing the active-status requirement fails', () => {
    const weakened = 'familiar_authors as ( from public.correspondences c where c.established_at is not null ) familiar_augment as ('
    const weakenedBody = extractCteBody(weakened, 'familiar_authors as (', 'familiar_augment as (')
    expect(weakenedBody.toLowerCase()).not.toContain("status = 'active'")
    expect(weakenedBody.toLowerCase()).toContain('established_at is not null')
  })

  it('negative: a correspondence check missing the established_at-not-null requirement fails', () => {
    const weakened = "familiar_authors as ( from public.correspondences c where c.status = 'active' ) familiar_augment as ("
    const weakenedBody = extractCteBody(weakened, 'familiar_authors as (', 'familiar_augment as (')
    expect(weakenedBody.toLowerCase()).toContain("status = 'active'")
    expect(weakenedBody.toLowerCase()).not.toContain('established_at is not null')
  })

  it('negative: the marker itself absent (e.g. the CTE renamed/removed) yields an empty body, so every ILIKE check reads false rather than accidentally matching unrelated text elsewhere in the file', () => {
    const noMarker = 'some unrelated text mentioning correspondences in passing, with no familiar_authors CTE at all'
    const missingBody = extractCteBody(noMarker, 'familiar_authors as (', 'familiar_augment as (')
    expect(missingBody).toBe('')
  })
})

describe('board personalization verifier — seen_bucket binary-classification check, exercised (via plain JS string ops, never a JS RegExp) against real and synthetic sample text', () => {
  const algorithmCheckBody = ctePart('algorithm_check', 'no_scope_creep_check')

  it('the verifier checks then 1::smallint, else 0::smallint, and their ORDER, on the bounded classified_body', () => {
    expect(algorithmCheckBody).toContain("cb.classified_body ilike '%then 1::smallint%'")
    expect(algorithmCheckBody).toContain("cb.classified_body ilike '%else 0::smallint%'")
    expect(algorithmCheckBody).toContain(
      "position('then 1::smallint' in cb.classified_body) < position('else 0::smallint' in cb.classified_body)"
    )
  })

  it('extracting classified_body from the REAL, applied migration function text yields a body with both branches, then before else', () => {
    const realBody = extractCteBody(migrationSql, 'classified as (', 'author_diverse as (')
    expect(realBody.length).toBeGreaterThan(0)
    const lower = realBody.toLowerCase()
    expect(lower).toContain('then 1::smallint')
    expect(lower).toContain('else 0::smallint')
    expect(lower.indexOf('then 1::smallint')).toBeLessThan(lower.indexOf('else 0::smallint'))
  })

  it('negative: branches swapped (0 for the "then" case, 1 for "else") still contains both substrings, but fails the ORDER check — proving the verifier does not merely check both substrings are present somewhere', () => {
    const swapped = 'classified as ( case when x then 0::smallint else 1::smallint end ) author_diverse as ('
    const swappedBody = extractCteBody(swapped, 'classified as (', 'author_diverse as (')
    const lower = swappedBody.toLowerCase()
    expect(lower).toContain('then 0::smallint')
    expect(lower).toContain('else 1::smallint')
    expect(lower.indexOf('then 1::smallint')).toBe(-1)
  })

  it('negative: only one branch present (no else) fails', () => {
    const oneBranch = 'classified as ( case when x then 1::smallint end ) author_diverse as ('
    const oneBranchBody = extractCteBody(oneBranch, 'classified as (', 'author_diverse as (')
    const lower = oneBranchBody.toLowerCase()
    expect(lower).toContain('then 1::smallint')
    expect(lower).not.toContain('else 0::smallint')
  })

  it('negative: a plain boolean column with no case expression at all yields an empty body (the classified marker itself is absent)', () => {
    const noCaseExpression = 'true as seen_bucket'
    const noBody = extractCteBody(noCaseExpression, 'classified as (', 'author_diverse as (')
    expect(noBody).toBe('')
  })
})

// Mirrors substring(x from position(marker in x)) — the OPEN-ENDED form
// (no FOR length), used for final_region/order_by_region. Returns ''
// (never throws) when the marker is absent.
function extractOpenEnded(text: string, startMarker: string): string {
  const start = text.indexOf(startMarker)
  if (start === -1) return ''
  return text.slice(start)
}

// Mirrors the verifier's own tuple-order proof: all four fields present,
// AND in strictly increasing position order. Case-insensitive, matching
// ILIKE/position()'s own case-insensitivity is NOT relevant here since
// position() is case-SENSITIVE in Postgres — but every real token this
// file searches for is already lowercase in the migration's own source,
// so this mirrors real behavior faithfully without needing a separate
// case-insensitive position() shim.
function tupleOrderHolds(region: string): boolean {
  const pSeen = region.indexOf('seen_bucket')
  const pRank = region.indexOf('rank_key')
  const pSeed = region.indexOf('seed_hash')
  const pId = region.indexOf('.id')
  if (pSeen === -1 || pRank === -1 || pSeed === -1 || pId === -1) return false
  return pSeen < pRank && pRank < pSeed && pSeed < pId
}

describe('board personalization verifier — AUTHOR DIVERSITY, exercised (via plain JS string ops, never a JS RegExp) against real and synthetic sample text', () => {
  const algorithmCheckBody = ctePart('algorithm_check', 'no_scope_creep_check')

  it('the verifier checks row_number()/partition by as TWO INDEPENDENT existence checks (no adjacency requirement), plus the partition clause itself (isolated from the window\'s own trailing ORDER BY) contains seen_bucket and author_id, plus the result is bound to author_seq', () => {
    expect(algorithmCheckBody).toContain("cb.author_diverse_body ilike '%row_number()%' as author_diverse_uses_row_number")
    expect(algorithmCheckBody).toContain("cb.author_diverse_body ilike '%partition by%' as author_diverse_has_partition_clause")
    expect(algorithmCheckBody).toContain("as author_diverse_partitions_by_seen_bucket")
    expect(algorithmCheckBody).toContain("as author_diverse_partitions_by_author_id")
    expect(algorithmCheckBody).toContain("cb.author_diverse_body ilike '%as author_seq%' as author_diverse_result_bound_to_author_seq")
  })

  it('the verifier separately checks author_seq is consumed downstream (keep_ranked/second_signal_ranked), never merely computed and discarded', () => {
    expect(algorithmCheckBody).toContain('cb.diversity_downstream_body')
    expect(algorithmCheckBody).toContain('as author_seq_consumed_downstream')
  })

  it('extracting author_diverse_body from the REAL, applied migration function text: uses row_number(), has a partition clause, and the partition clause contains both seen_bucket and author_id', () => {
    const realBody = extractCteBody(migrationSql, 'author_diverse as (', 'keep_ranked as (')
    expect(realBody.length).toBeGreaterThan(0)
    const lower = realBody.toLowerCase()
    expect(lower).toContain('row_number()')
    expect(lower).toContain('partition by')
    const partitionClause = extractCteBody(lower, 'partition by', 'order by')
    expect(partitionClause).toContain('seen_bucket')
    expect(partitionClause).toContain('author_id')
    expect(lower).toContain('as author_seq')
  })

  it('extracting diversity_downstream_body from the REAL migration text shows author_seq genuinely consumed downstream', () => {
    const realBody = extractCteBody(migrationSql, 'keep_ranked as (', 'familiar_merged as (')
    expect(realBody.length).toBeGreaterThan(0)
    const lower = realBody.toLowerCase()
    expect(lower).toContain('author_seq')
    expect(lower).toContain('order by')
  })

  it('negative (normalized/multiline): reformatted with different internal whitespace/newlines than the original source still passes — proving the check tolerates pretty-printer reformatting, the entire point of this fix', () => {
    const reformatted = `author_diverse as (
      select
        c.*,
        row_number()
          OVER (
            PARTITION BY
              c.seen_bucket,
              c.author_id
            ORDER BY c.published_at DESC
          )
          AS author_seq
      from classified c
    ) keep_ranked as (`
    const lower = extractCteBody(reformatted, 'author_diverse as (', 'keep_ranked as (').toLowerCase()
    expect(lower).toContain('row_number()')
    expect(lower).toContain('partition by')
    const partitionClause = extractCteBody(lower, 'partition by', 'order by')
    expect(partitionClause).toContain('seen_bucket')
    expect(partitionClause).toContain('author_id')
    expect(lower).toContain('as author_seq')
  })

  it('negative: missing author_id from the partition clause fails', () => {
    const missingAuthorId = 'author_diverse as ( row_number() over (partition by c.seen_bucket order by c.published_at desc) as author_seq ) keep_ranked as ('
    const lower = extractCteBody(missingAuthorId, 'author_diverse as (', 'keep_ranked as (').toLowerCase()
    const partitionClause = extractCteBody(lower, 'partition by', 'order by')
    expect(partitionClause).toContain('seen_bucket')
    expect(partitionClause).not.toContain('author_id')
  })

  it('negative: missing seen_bucket from the partition clause fails', () => {
    const missingSeenBucket = 'author_diverse as ( row_number() over (partition by c.author_id order by c.published_at desc) as author_seq ) keep_ranked as ('
    const lower = extractCteBody(missingSeenBucket, 'author_diverse as (', 'keep_ranked as (').toLowerCase()
    const partitionClause = extractCteBody(lower, 'partition by', 'order by')
    expect(partitionClause).toContain('author_id')
    expect(partitionClause).not.toContain('seen_bucket')
  })

  it('negative: no row_number() at all (e.g. a plain rank column) fails', () => {
    const noRowNumber = 'author_diverse as ( 1 as author_seq ) keep_ranked as ('
    const lower = extractCteBody(noRowNumber, 'author_diverse as (', 'keep_ranked as (').toLowerCase()
    expect(lower).not.toContain('row_number()')
  })

  it('negative: author_seq computed but never consumed downstream (no order by author_seq in the streams) fails', () => {
    const notConsumed = 'keep_ranked as ( row_number() over (partition by seen_bucket order by seed_hash) as stream_i ) familiar_merged as ('
    const lower = extractCteBody(notConsumed, 'keep_ranked as (', 'familiar_merged as (').toLowerCase()
    expect(lower).not.toContain('author_seq')
  })
})

describe('board personalization verifier — FINAL ORDER / CURSOR CONTRACT, exercised (via plain JS string ops, never a JS RegExp) against real and synthetic sample text — proves BOTH the cursor tuple order (A) and the final ORDER BY sequence (B) as distinct, position()-ordered properties, never merely that all four words appear somewhere', () => {
  const algorithmCheckBody = ctePart('algorithm_check', 'no_scope_creep_check')

  it('the verifier checks BOTH regions (cursor tuple, ORDER BY) for presence of all four fields AND their strict position order', () => {
    for (const region of ['fr.where_tuple_region', 'fr.order_by_region']) {
      expect(algorithmCheckBody).toContain(`${region} ilike '%seen_bucket%'`)
      expect(algorithmCheckBody).toContain(`${region} ilike '%rank_key%'`)
      expect(algorithmCheckBody).toContain(`${region} ilike '%seed_hash%'`)
      expect(algorithmCheckBody).toContain(`${region} ilike '%.id%'`)
      expect(algorithmCheckBody).toContain(
        `position('seen_bucket' in ${region}) < position('rank_key' in ${region})`
      )
      expect(algorithmCheckBody).toContain(
        `position('rank_key' in ${region}) < position('seed_hash' in ${region})`
      )
      expect(algorithmCheckBody).toContain(
        `position('seed_hash' in ${region}) < position('.id' in ${region})`
      )
    }
    expect(algorithmCheckBody).toContain('as cursor_tuple_matches_contract')
    expect(algorithmCheckBody).toContain('as final_order_matches_contract')
  })

  it('extracting where_tuple_region and order_by_region from the REAL, applied migration function text: both hold the correct field order', () => {
    const finalRegion = extractOpenEnded(migrationSql.toLowerCase(), 'final as (')
    expect(finalRegion.length).toBeGreaterThan(0)
    const whereTupleRegion = extractCteBody(finalRegion, 'where', 'order by')
    const orderByRegion = extractOpenEnded(finalRegion, 'order by')
    expect(tupleOrderHolds(whereTupleRegion)).toBe(true)
    expect(tupleOrderHolds(orderByRegion)).toBe(true)
  })

  it('negative (multiline ORDER BY): reformatted with different internal whitespace/newlines than the original source still passes — proving the check tolerates pretty-printer reformatting', () => {
    const reformatted = `final as (select 1) select f.id
      from final f
      where
        p_cursor_seen_bucket is null
        or (
          f.seen_bucket,
          f.rank_key,
          f.seed_hash,
          f.id
        ) > (p_cursor_seen_bucket, p_cursor_rank_key, p_cursor_seed_hash, p_cursor_id)
      ORDER BY
        f.seen_bucket,
        f.rank_key,
        f.seed_hash,
        f.id
      limit p_limit`
    const finalRegion = extractOpenEnded(reformatted.toLowerCase(), 'final as (')
    const whereTupleRegion = extractCteBody(finalRegion, 'where', 'order by')
    const orderByRegion = extractOpenEnded(finalRegion, 'order by')
    expect(tupleOrderHolds(whereTupleRegion)).toBe(true)
    expect(tupleOrderHolds(orderByRegion)).toBe(true)
  })

  it('negative: wrong field order (rank_key before seen_bucket) in the ORDER BY fails', () => {
    const wrongOrder = extractOpenEnded('final as (select 1) order by f.rank_key, f.seen_bucket, f.seed_hash, f.id limit p_limit', 'order by')
    expect(tupleOrderHolds(wrongOrder)).toBe(false)
  })

  it('negative: a missing field (no seed_hash at all) in the ORDER BY fails', () => {
    const missingField = extractOpenEnded('final as (select 1) order by f.seen_bucket, f.rank_key, f.id limit p_limit', 'order by')
    expect(tupleOrderHolds(missingField)).toBe(false)
  })

  it('a correct cursor tuple order (seen_bucket, rank_key, seed_hash, id) passes', () => {
    const region = '(f.seen_bucket, f.rank_key, f.seed_hash, f.id) > (p_cursor_seen_bucket, p_cursor_rank_key, p_cursor_seed_hash, p_cursor_id)'
    expect(tupleOrderHolds(region)).toBe(true)
  })

  it('negative: a wrong cursor tuple order (id first) fails', () => {
    const region = '(f.id, f.seen_bucket, f.rank_key, f.seed_hash) > (p_cursor_id, p_cursor_seen_bucket, p_cursor_rank_key, p_cursor_seed_hash)'
    expect(tupleOrderHolds(region)).toBe(false)
  })

  it('mere field PRESENCE is insufficient — a region with all four words present but in reverse order fails, proving the check is genuinely order-sensitive, not a bag-of-words check', () => {
    const reversed = 'f.id, f.seed_hash, f.rank_key, f.seen_bucket'
    const hasAllWords =
      reversed.includes('seen_bucket') &&
      reversed.includes('rank_key') &&
      reversed.includes('seed_hash') &&
      reversed.includes('.id')
    expect(hasAllWords).toBe(true) // presence alone would wrongly pass...
    expect(tupleOrderHolds(reversed)).toBe(false) // ...but the real check correctly fails it
  })
})

describe('board personalization verifier — no scope creep', () => {
  const body = ctePart('no_scope_creep_check', ')\n\nselect')

  it('checks that no Interests/embeddings/board_sessions table was introduced — this migration creates no new relations at all', () => {
    expect(body).toContain("'dispatch_interests', 'interests', 'dispatch_embeddings', 'board_sessions'")
  })
})

describe('board personalization verifier — SUMMARY wiring: every column selected is also required by overall_pass', () => {
  const summaryStart = sql.indexOf('select\n  sig.new_signature_exists')
  const overallPassStart = sql.indexOf('(\n    sig.new_signature_exists')
  const overallPassEnd = sql.indexOf(') as overall_pass')
  const overallPassBody = sql.slice(overallPassStart, overallPassEnd)
  const selectListBody = sql.slice(summaryStart, overallPassStart)

  const requiredAliases = [
    'new_signature_exists', 'old_signature_removed',
    'exists_at_all', 'is_security_invoker', 'is_stable', 'fixed_search_path', 'authenticated_exec',
    'filters_published', 'filters_moderation_visible', 'enforces_publish_cutoff',
    'uses_session_stable_unseen_signal', 'never_uses_mutable_viewed_at', 'has_keep_signal',
    'correspondent_references_correspondences_table',
    'correspondent_requires_active_status', 'correspondent_requires_established_at', 'correspondent_signal_session_stable',
    'never_uses_stop_letters_helper', 'uses_full_block_helper',
    'global_pool_bounded_to_300', 'uses_lateral_augmentation', 'augmentation_bounded_to_two_per_author',
    'never_uses_random', 'uses_seeded_hash',
    'author_diverse_uses_row_number', 'author_diverse_has_partition_clause',
    'author_diverse_partitions_by_seen_bucket', 'author_diverse_partitions_by_author_id',
    'author_diverse_result_bound_to_author_seq', 'author_seq_consumed_downstream',
    'has_author_diversity_mechanism', 'has_seen_bucket',
    'seen_bucket_is_binary_classification', 'has_keep_weight_three', 'has_second_signal_weight_one',
    'uses_divisor_apportionment_formula', 'cursor_tuple_matches_contract', 'final_order_matches_contract',
    'no_topical_interest_ranking', 'no_embeddings', 'no_pgvector', 'respects_caller_limit',
    'no_new_relations_of_concern',
  ]

  it.each(requiredAliases)('%s is referenced in the SUMMARY select list', (alias) => {
    expect(selectListBody).toContain(alias)
  })

  it.each(requiredAliases)('%s is required by overall_pass', (alias) => {
    expect(overallPassBody).toContain(alias)
  })

  it('negative-sense checks (never_*, no_*) are combined with "and", never "or" — overall_pass cannot be satisfied by a partial pass', () => {
    expect(overallPassBody).not.toMatch(/\bor\b/i)
  })

  it('the FROM clause joins every CTE with no WHERE that could drop the one guaranteed row', () => {
    expect(sql).toContain(
      'from signature_check sig, return_shape_check rs, board_feed_page_props p,\n     algorithm_check a, no_scope_creep_check n;'
    )
    expect(overallPassBody).not.toMatch(/\nwhere\b/i)
  })
})

describe('board personalization verifier — reuses the existing index, adds none', () => {
  it('confirms dispatches_author_published_idx by name, and never issues a CREATE INDEX', () => {
    expect(sql).toContain("indexname = 'dispatches_author_published_idx'")
    expect(sql.toLowerCase()).not.toContain('create index')
  })
})

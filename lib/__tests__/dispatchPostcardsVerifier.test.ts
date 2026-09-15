// Dispatch Postcards Checkpoint 2 — same source-text-inspection approach
// as dispatchWorthReadingVerifier.test.ts/dispatchRepliesVerifier.test.ts,
// since there is no live Postgres to run the verifier against here. This
// file was added during the final pre-Supabase review pass that also
// corrected the verifier itself (see that migration's own SQL comments):
// update_dispatch's authoritative signature is FIVE arguments, not four
// (the prohibited hypothetical Postcard overload is therefore SIX, not
// five), and publish_dispatch — newly converted from SECURITY INVOKER to
// SECURITY DEFINER by this checkpoint — needed an explicit proof that it
// accepts no caller-supplied author/user UUID and that its Dispatch
// INSERT derives author_id from auth.uid() itself, not a parameter.
//
// LIVE-DIAGNOSTIC FOLLOW-UP (migration now APPLIED to Supabase): the
// first live run of this verifier read overall_pass=false on exactly two
// predicates — delegates_through_dispatches and (the then-single)
// all_checks_correct — both confirmed, by reading the actual live
// catalog definitions, to be VERIFIER false negatives caused by
// PostgreSQL's own storage/pretty-print normalization (dropping the
// unambiguous `public.` schema qualifier from a policy's pg_get_expr
// output; rewriting a stored CHECK constraint's `BETWEEN a AND b` into
// an equivalent `>= a AND <= b` pair) — never a defect in the applied
// migration itself, which is correct and untouched by this pass. Tests
// below reproduce those EXACT live-normalized strings verbatim (quoted
// in the review conversation) and prove the corrected patterns pass
// them, while still proving the original malformed/weakened variants
// this checkpoint's own security requirements care about continue to
// fail — this file gained real regex-behavior assertions (constructing
// a JS RegExp from the SQL's own `~*` pattern source and running it
// against sample text), not just source-text `toContain` checks, so the
// checks themselves are actually exercised, not merely present.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-25-dispatch-postcards-verify.sql')

const sql = readFileSync(VERIFIER_PATH, 'utf8')

function ctePart(name: string, nextName: string): string {
  const start = sql.indexOf(`${name} as (`)
  expect(start, `expected to find CTE "${name}" in the verifier`).toBeGreaterThan(-1)
  const end = sql.indexOf(`${nextName} as (`, start)
  expect(end, `expected to find the following CTE "${nextName}" after "${name}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('dispatch postcards verifier source — read-only', () => {
  it('contains no INSERT, UPDATE, DELETE, or DDL statement anywhere (outside of read-only ilike/like/position introspection of the checked functions\' own source text)', () => {
    const lower = sql.toLowerCase()
    // Comment lines are excluded from this scan — a prose comment
    // EXPLAINING a read-only proof (e.g. "the exact authoritative insert
    // path (`insert into public.dispatches ...`)") legitimately contains
    // the literal substring without an ilike/position() marker on that
    // same wrapped line; only executable code lines need that marker.
    const linesWithMutationText = lower
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .filter((line) => /insert into|delete from|update public\./.test(line))
    for (const line of linesWithMutationText) {
      const isReadOnlyIntrospection = /\bi?like\b|\bposition\s*\(/.test(line)
      expect(isReadOnlyIntrospection).toBe(true)
    }
    expect(lower).not.toContain('create table')
    expect(lower).not.toContain('alter table')
    expect(lower).not.toContain('drop table')
    expect(lower).not.toContain('create policy')
    expect(lower).not.toContain('drop policy')
  })

  it('every non-comment, non-blank line is a read-only construct, never a mutation keyword', () => {
    const codeLines = sql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
    const mutationKeywords = /^(insert|update|delete|drop|alter|create(?!\s+or\s+replace\s+function)|truncate|grant|revoke)\b/i
    const offending = codeLines.filter((line) => mutationKeywords.test(line))
    expect(offending).toEqual([])
  })
})

describe('dispatch postcards verifier — update_dispatch terminology (final pre-Supabase review correction)', () => {
  const body = ctePart('update_dispatch_check', 'shared_check')

  it('checks the authoritative FIVE-argument update_dispatch signature, named accordingly', () => {
    expect(body).toContain("to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)') is not null")
    expect(body).toContain('as five_arg_signature_still_authoritative')
    // The old, miscounted alias must be gone entirely — not merely
    // superseded alongside it.
    expect(body).not.toContain('four_arg_signature_still_authoritative')
  })

  it('checks that no SIX-argument Postcard overload exists, named accordingly', () => {
    expect(body).toContain("to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb, jsonb)') is null")
    expect(body).toContain('as no_six_arg_postcard_overload_exists')
    expect(body).not.toContain('no_postcard_overload_exists')
  })

  it('does not change the actual signatures being checked — same two to_regprocedure calls as before the terminology fix', () => {
    expect(body).toContain('public.update_dispatch(uuid, text, text, text[], jsonb)')
    expect(body).toContain('public.update_dispatch(uuid, text, text, text[], jsonb, jsonb)')
  })

  it('still proves the function body never references p_postcard or dispatch_postcards', () => {
    expect(body).toContain('as body_never_references_p_postcard')
    expect(body).toContain('as body_never_touches_dispatch_postcards')
  })
})

describe('dispatch postcards verifier — check_constraint_check semantic bounds (live-diagnostic follow-up: BETWEEN normalization tolerance)', () => {
  const body = ctePart('check_constraint_check', 'policy_check')
  const REVEAL_NULL_PATTERN = String.raw`reveal_line\s+is\s+null`
  const REVEAL_BOUND_PATTERN = String.raw`char_length\(\s*reveal_line\s*\)\s*<=\s*32`
  const BACK_LOWER_PATTERN = String.raw`char_length\(\s*trim\(\s*both\s+from\s+back_message\s*\)\s*\)\s*>=\s*1`
  const BACK_UPPER_PATTERN = String.raw`char_length\(\s*trim\(\s*both\s+from\s+back_message\s*\)\s*\)\s*<=\s*200`

  it('no longer requires the migration\'s own source spelling "between 1 and 200" to survive storage verbatim — proves semantic bounds instead', () => {
    expect(body.toLowerCase()).not.toContain('between 1 and 200')
    expect(body).toContain(REVEAL_NULL_PATTERN)
    expect(body).toContain(REVEAL_BOUND_PATTERN)
    expect(body).toContain(BACK_LOWER_PATTERN)
    expect(body).toContain(BACK_UPPER_PATTERN)
  })

  it('reveal_line: matches the EXACT live normalized constraint definition PostgreSQL returned', () => {
    const live = 'CHECK (((reveal_line IS NULL) OR (char_length(reveal_line) <= 32)))'
    expect(new RegExp(REVEAL_NULL_PATTERN, 'i').test(live)).toBe(true)
    expect(new RegExp(REVEAL_BOUND_PATTERN, 'i').test(live)).toBe(true)
  })

  it('back_message: matches the EXACT live normalized constraint definition PostgreSQL returned (BETWEEN rewritten as >= ... AND <= ...)', () => {
    const live =
      'CHECK (((char_length(TRIM(BOTH FROM back_message)) >= 1) AND (char_length(TRIM(BOTH FROM back_message)) <= 200)))'
    expect(new RegExp(BACK_LOWER_PATTERN, 'i').test(live)).toBe(true)
    expect(new RegExp(BACK_UPPER_PATTERN, 'i').test(live)).toBe(true)
  })

  it('negative: a back_message constraint missing the >= 1 lower bound fails the lower-bound proof (and only that one)', () => {
    const weakened = 'CHECK (char_length(TRIM(BOTH FROM back_message)) <= 200)'
    expect(new RegExp(BACK_LOWER_PATTERN, 'i').test(weakened)).toBe(false)
    expect(new RegExp(BACK_UPPER_PATTERN, 'i').test(weakened)).toBe(true)
  })

  it('negative: a back_message constraint missing the <= 200 upper bound fails the upper-bound proof (and only that one)', () => {
    const weakened = 'CHECK (char_length(TRIM(BOTH FROM back_message)) >= 1)'
    expect(new RegExp(BACK_LOWER_PATTERN, 'i').test(weakened)).toBe(true)
    expect(new RegExp(BACK_UPPER_PATTERN, 'i').test(weakened)).toBe(false)
  })

  it('negative: a reveal_line constraint missing the <= 32 bound fails', () => {
    const weakened = 'CHECK (reveal_line IS NULL)'
    expect(new RegExp(REVEAL_NULL_PATTERN, 'i').test(weakened)).toBe(true)
    expect(new RegExp(REVEAL_BOUND_PATTERN, 'i').test(weakened)).toBe(false)
  })

  it('each bound is its own independently-diagnosable column, wrapped in coalesce(..., false) — never merged into one opaque all_checks_correct', () => {
    expect(body).not.toContain('all_checks_correct')
    for (const alias of ['reveal_line_bound_correct', 'back_message_lower_bound_correct', 'back_message_upper_bound_correct']) {
      expect(body).toContain(`as ${alias}`)
      const checkStart = body.indexOf(`as ${alias}`)
      const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
      const predicate = body.slice(coalesceStart, checkStart)
      expect(predicate.trim()).toMatch(/,\s*false\s*\)\s*$/)
    }
  })
})

describe('dispatch postcards verifier — delegates_through_dispatches (live-diagnostic follow-up: optional schema qualifier)', () => {
  const body = ctePart('policy_check', 'grant_check')
  const SHAPE_PATTERN = String.raw`exists\s*\(\s*select\s+1\s*from\s+(public\.)?dispatches\s+d`
  const CORRELATION_PATTERN = String.raw`d\.id\s*=\s*dispatch_postcards\.dispatch_id`

  it('the SQL uses these exact two ANDed patterns — schema qualifier now optional, correlation still required', () => {
    expect(body).toContain(SHAPE_PATTERN)
    expect(body).toContain(CORRELATION_PATTERN)
  })

  it('matches the EXACT live normalized policy text PostgreSQL returned (no `public.` qualifier)', () => {
    const liveNormalized =
      '(EXISTS ( SELECT 1\n   FROM dispatches d\n  WHERE (d.id = dispatch_postcards.dispatch_id)))'
    expect(new RegExp(SHAPE_PATTERN, 'i').test(liveNormalized)).toBe(true)
    expect(new RegExp(CORRELATION_PATTERN, 'i').test(liveNormalized)).toBe(true)
  })

  it('still matches if PostgreSQL DID include the schema qualifier — the qualifier is optional, not forbidden', () => {
    const qualified = '(EXISTS ( SELECT 1\n   FROM public.dispatches d\n  WHERE (d.id = dispatch_postcards.dispatch_id)))'
    expect(new RegExp(SHAPE_PATTERN, 'i').test(qualified)).toBe(true)
    expect(new RegExp(CORRELATION_PATTERN, 'i').test(qualified)).toBe(true)
  })

  it('negative: a policy that references dispatches but does NOT correlate d.id to dispatch_postcards.dispatch_id fails the correlation proof — never passes on the bare word "dispatches" alone', () => {
    const uncorrelated = '(EXISTS ( SELECT 1\n   FROM dispatches d\n  WHERE (d.author_id = auth.uid())))'
    // The EXISTS/FROM/alias shape alone is genuinely present...
    expect(new RegExp(SHAPE_PATTERN, 'i').test(uncorrelated)).toBe(true)
    // ...but the required join correlation is absent, so the combined
    // (AND) predicate the SQL actually evaluates fails overall — this is
    // what keeps the check from weakening into a bare "dispatches" scan.
    expect(new RegExp(CORRELATION_PATTERN, 'i').test(uncorrelated)).toBe(false)
  })

  it('negative: a bare mention of the word "dispatches" with no EXISTS/SELECT/FROM shape at all fails outright', () => {
    const bareWord = 'some unrelated text mentioning dispatches in passing'
    expect(new RegExp(SHAPE_PATTERN, 'i').test(bareWord)).toBe(false)
    expect(new RegExp(CORRELATION_PATTERN, 'i').test(bareWord)).toBe(false)
  })

  it('both patterns are combined with AND inside one coalesce(..., false) — never two independent, separately-passable checks', () => {
    const checkStart = body.indexOf('as delegates_through_dispatches')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toMatch(/~\*[\s\S]*\band\b[\s\S]*~\*/)
    expect(predicate.trim()).toMatch(/,\s*false\s*\)\s*$/)
  })
})

describe('dispatch postcards verifier — publish_dispatch SECURITY DEFINER proof (final pre-Supabase review addition)', () => {
  const body = ctePart('publish_check', 'update_dispatch_check')

  it('proves publish_dispatch has no caller-supplied author/user UUID argument, via its identity argument list — not a parameter-name guess', () => {
    expect(body).toContain('pg_get_function_identity_arguments(p.oid)')
    expect(body).toContain("not ilike '%uuid%'")
    expect(body).toContain('as no_caller_supplied_author_uuid_argument')
  })

  it('the UUID-argument check is wrapped in coalesce(..., false) — fails safe if the function is missing', () => {
    const checkStart = body.indexOf('as no_caller_supplied_author_uuid_argument')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate.trim().endsWith(', false)')).toBe(true)
  })

  it('proves the Dispatch INSERT derives author_id from auth.uid() itself — the exact authoritative insert path', () => {
    expect(body).toContain('as dispatch_insert_derives_author_id_from_auth_uid')
    const checkStart = body.indexOf('as dispatch_insert_derives_author_id_from_auth_uid')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(
      "position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid))"
    )
    expect(predicate).toContain("position('values (auth.uid(), p_title, p_body, ''published'', now())' in pg_get_functiondef(p.oid))")
  })

  it('IMPORTANT correction discipline: both position() calls are proven > 0 (genuinely found) before the ordering comparison — never a bare comparison that could pass on a false premise', () => {
    const checkStart = body.indexOf('as dispatch_insert_derives_author_id_from_auth_uid')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(
      "position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid)) > 0"
    )
    expect(predicate).toContain("position('values (auth.uid(), p_title, p_body, ''published'', now())' in pg_get_functiondef(p.oid)) > 0")
    // The ordering comparison itself must come after both existence
    // proofs, not stand alone.
    const firstExistenceProof = predicate.indexOf(
      "position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid)) > 0"
    )
    const orderingComparison = predicate.indexOf(
      "position('insert into public.dispatches (author_id, title, body, status, published_at)' in pg_get_functiondef(p.oid))\n        <"
    )
    expect(orderingComparison).toBeGreaterThan(firstExistenceProof)
  })

  it('is wrapped in coalesce(..., false) — fails safe, never a bare unguarded comparison', () => {
    const checkStart = body.indexOf('as dispatch_insert_derives_author_id_from_auth_uid')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    // The closing `, false\n    )` sits on its own line (the predicate
    // spans several lines) — tolerant of the whitespace/newline between
    // "false" and the closing paren, unlike a single-line predicate's
    // exact ", false)" adjacency.
    expect(predicate.trim()).toMatch(/,\s*false\s*\)\s*$/)
  })
})

describe('dispatch postcards verifier — SUMMARY wiring for the corrected/new properties', () => {
  const summaryStart = sql.indexOf('select\n  t.table_exists')
  const overallPassStart = sql.indexOf('(\n    t.table_exists')
  const overallPassEnd = sql.indexOf(') as overall_pass')
  const overallPassBody = sql.slice(overallPassStart, overallPassEnd)
  const selectListBody = sql.slice(summaryStart, overallPassStart)

  it('the renamed update_dispatch columns are selected in the SUMMARY output', () => {
    expect(selectListBody).toContain('upd.five_arg_signature_still_authoritative')
    expect(selectListBody).toContain('upd.no_six_arg_postcard_overload_exists')
    expect(selectListBody).not.toContain('upd.four_arg_signature_still_authoritative')
    expect(selectListBody).not.toContain('upd.no_postcard_overload_exists')
  })

  it('the two new publish_dispatch SECURITY DEFINER properties are selected in the SUMMARY output', () => {
    expect(selectListBody).toContain('pub.no_caller_supplied_author_uuid_argument')
    expect(selectListBody).toContain('pub.dispatch_insert_derives_author_id_from_auth_uid')
  })

  it('the three granular check_constraint_check bounds are selected in the SUMMARY output — never a single bundled all_checks_correct', () => {
    expect(selectListBody).toContain('cc.reveal_line_bound_correct')
    expect(selectListBody).toContain('cc.back_message_lower_bound_correct')
    expect(selectListBody).toContain('cc.back_message_upper_bound_correct')
    expect(selectListBody).not.toContain('cc.all_checks_correct')
  })

  it('overall_pass depends on the renamed update_dispatch columns', () => {
    expect(overallPassBody).toContain('upd.five_arg_signature_still_authoritative')
    expect(overallPassBody).toContain('upd.no_six_arg_postcard_overload_exists')
    expect(overallPassBody).not.toContain('upd.four_arg_signature_still_authoritative')
    expect(overallPassBody).not.toContain('upd.no_postcard_overload_exists')
  })

  it('overall_pass depends on both new publish_dispatch SECURITY DEFINER properties', () => {
    expect(overallPassBody).toContain('pub.no_caller_supplied_author_uuid_argument')
    expect(overallPassBody).toContain('pub.dispatch_insert_derives_author_id_from_auth_uid')
  })

  it('overall_pass depends on all three granular check_constraint_check bounds', () => {
    expect(overallPassBody).toContain('cc.reveal_line_bound_correct')
    expect(overallPassBody).toContain('cc.back_message_lower_bound_correct')
    expect(overallPassBody).toContain('cc.back_message_upper_bound_correct')
    expect(overallPassBody).not.toContain('cc.all_checks_correct')
  })

  it('the FROM clause still joins every CTE with no WHERE that could drop the one guaranteed row', () => {
    expect(sql).toContain(
      'from table_check t, column_check col, pk_check pk, fk_check fk, check_constraint_check cc,\n     policy_check pol, grant_check g, publish_check pub, update_dispatch_check upd,\n     shared_check sh, no_denormalization_check nd;'
    )
    expect(overallPassBody).not.toMatch(/\nwhere\b/i)
  })
})

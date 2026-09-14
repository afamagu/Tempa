// Board Feed Foundation checkpoint (Phase 2A) — post-live-verification
// correction. Live diagnostics against the successfully applied migration
// found three false negatives in the VERIFIER file itself (never in the
// migration's own executable SQL, which was independently confirmed
// correct). This file guards each corrected root cause against
// regression, the same source-text-inspection approach used throughout
// this repo (see boardFeedMigration.test.ts, blockUserOverloadMigration.
// test.ts) since there is no live Postgres to run the verifier against in
// this test environment.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-22-board-feed-foundation-verify.sql')

const sql = readFileSync(VERIFIER_PATH, 'utf8')

describe('board feed foundation verifier source — correction 1: schema USAGE, not function-level EXECUTE, for the tempa_private helper', () => {
  it('checks authenticated and anon schema USAGE on tempa_private, not anon function-level EXECUTE', () => {
    expect(sql).toContain("has_schema_privilege('authenticated', 'tempa_private', 'USAGE') as authenticated_schema_usage")
    expect(sql).toContain("has_schema_privilege('anon', 'tempa_private', 'USAGE') as anon_schema_usage")
  })

  it('the author_visibility_check CTE itself no longer asserts anon lacks function-level EXECUTE — it deliberately keeps default PUBLIC execute', () => {
    const start = sql.indexOf('author_visibility_check as (')
    const end = sql.indexOf('dispatches_policy_check as (')
    const cte = sql.slice(start, end)
    expect(cte).not.toContain("has_function_privilege('anon', p.oid, 'EXECUTE')")
    expect(cte).toContain("has_schema_privilege('authenticated', 'tempa_private', 'USAGE')")
    expect(cte).toContain("has_schema_privilege('anon', 'tempa_private', 'USAGE')")
  })

  it('the overall_pass condition requires authenticated schema USAGE and forbids anon schema USAGE', () => {
    // CRLF-safe: slice from the first "overall_pass" mention onward
    // (covers both the column alias and the boolean expression beneath
    // it) rather than matching a multi-line literal.
    const region = sql.slice(sql.indexOf('overall_pass'))
    expect(region).toContain('a.authenticated_schema_usage')
    expect(region).toContain('not a.anon_schema_usage')
  })
})

describe('board feed foundation verifier source — correction 2: author-own RLS exception, regex-tolerant of pg_get_expr\'s own parenthesization', () => {
  it('uses a regex match, not a brittle exact-substring ILIKE, for the author-own branch', () => {
    expect(sql).toContain("~* 'or\\s*\\(*\\s*author_id\\s*=\\s*auth\\.uid\\(\\)\\s*\\)*'")
  })

  it('no longer relies on the old exact-substring form, which never matches pg_get_expr\'s own added parentheses', () => {
    expect(sql).not.toContain("ilike '%or author_id = auth.uid()%'")
  })

  it('the regex still requires "or" immediately adjacent to the equality — proving the connected branch, not two independently-matched tokens', () => {
    // A string containing both tokens but NOT adjacent/connected as
    // "or ... author_id = auth.uid()" must not satisfy the pattern —
    // extracted and tested against the actual regex source, mirroring
    // how Postgres' own ~* operator would evaluate it structurally.
    const patternSource = 'or\\s*\\(*\\s*author_id\\s*=\\s*auth\\.uid\\(\\)\\s*\\)*'
    const regex = new RegExp(patternSource, 'i')
    const connected = 'status = \'published\' OR (author_id = auth.uid())'
    const disconnectedTokensOnly = 'author_id is referenced elsewhere, and separately auth.uid() appears too, or nothing else connects them'
    expect(regex.test(connected)).toBe(true)
    expect(regex.test(disconnectedTokensOnly)).toBe(false)
  })
})

describe('board feed foundation verifier source — correction 3: pg_trigger.tgtype bitmask', () => {
  it('uses the correct catalog bit values: ROW=1, BEFORE=2, UPDATE=16', () => {
    expect(sql).toContain('t.tgtype & 1 = 1    -- ROW')
    expect(sql).toContain('t.tgtype & 2 = 2    -- BEFORE')
    expect(sql).toContain('t.tgtype & 16 = 16  -- UPDATE')
  })

  it('no longer uses the incorrect prior bit values (16 for BEFORE, 4 for UPDATE)', () => {
    expect(sql).not.toContain('t.tgtype & 16 = 16  -- BEFORE')
    expect(sql).not.toContain('t.tgtype & 4 = 4    -- UPDATE')
  })

  it('19 (the live trigger\'s real tgtype: ROW + BEFORE + UPDATE FOR EACH ROW) satisfies all three corrected bit checks', () => {
    const tgtype = 19
    expect((tgtype & 1) === 1).toBe(true)
    expect((tgtype & 2) === 2).toBe(true)
    expect((tgtype & 16) === 16).toBe(true)
    // And the OLD, incorrect UPDATE bit (4) is NOT set on 19 — proving
    // exactly why the pre-correction verifier produced a false negative
    // on this genuinely correct, live trigger.
    expect((tgtype & 4) === 4).toBe(false)
  })
})

describe('board feed foundation verifier source — remains read-only', () => {
  it('contains no INSERT, UPDATE, DELETE, or DDL statement anywhere', () => {
    const lower = sql.toLowerCase()
    expect(lower).not.toContain('insert into')
    expect(lower).not.toContain('delete from')
    expect(lower).not.toContain('update public.')
    expect(lower).not.toContain('create table')
    expect(lower).not.toContain('alter table')
    expect(lower).not.toContain('drop table')
    expect(lower).not.toContain('create policy')
    expect(lower).not.toContain('drop policy')
  })

  it('every non-comment, non-blank line is a read-only construct (with/select/from/join/where/etc.), never a mutation keyword', () => {
    const codeLines = sql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
    const mutationKeywords = /^(insert|update|delete|drop|alter|create(?!\s+or\s+replace\s+function)|truncate|grant|revoke)\b/i
    const offending = codeLines.filter((line) => mutationKeywords.test(line))
    expect(offending).toEqual([])
  })
})

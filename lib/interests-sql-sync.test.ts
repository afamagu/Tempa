// Board Personalization Phase 2B — ONE lightweight cross-check, not a
// giant source-text verifier: proves docs/sql/2026-09-27-topical-
// interests.sql's seed data (the interests/interest_topic_aliases INSERT
// statements) stays byte-for-byte in sync with lib/interests.ts's own
// INTEREST_TAXONOMY/INTEREST_ALIASES constants, which this migration's
// own header comment documents as the source of truth. Catches drift the
// instant either file is edited without the other, without the ceremony
// of a 100-predicate pg_get_functiondef-scanning suite.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { INTEREST_TAXONOMY, INTEREST_ALIASES } from './interests'

const sql = readFileSync(
  path.join(__dirname, '..', 'docs', 'sql', '2026-09-27-topical-interests.sql'),
  'utf8'
)

function parseSqlPairs(insertMarker: string, endMarker: string): [string, string][] {
  const start = sql.indexOf(insertMarker)
  const end = sql.indexOf(endMarker, start)
  const block = sql.slice(start, end)
  return [...block.matchAll(/\('([a-z0-9-]+)',\s*'([^']*)'/g)].map((m) => [m[1], m[2]])
}

describe('interests taxonomy <-> SQL seed data stay in sync', () => {
  it('every taxonomy (key, label) pair in lib/interests.ts appears in the SQL insert, and nothing extra is in SQL', () => {
    const sqlPairs = parseSqlPairs('insert into public.interests', 'INTEREST_TOPIC_ALIASES')
      .map(([key, label]) => `${key}|${label}`)
    const tsPairs = INTEREST_TAXONOMY.map((i) => `${i.key}|${i.label}`)
    expect(new Set(sqlPairs)).toEqual(new Set(tsPairs))
    expect(sqlPairs.length).toBe(tsPairs.length)
  })

  it('every (interest_key, alias) pair in lib/interests.ts INTEREST_ALIASES appears in the SQL insert, and nothing extra is in SQL', () => {
    const sqlPairs = parseSqlPairs('insert into public.interest_topic_aliases', 'PROFILE_INTERESTS')
      .map(([key, alias]) => `${key}|${alias}`)
    const tsPairs: string[] = []
    for (const [key, aliases] of Object.entries(INTEREST_ALIASES)) {
      for (const alias of aliases) tsPairs.push(`${key}|${alias}`)
    }
    const missingFromSql = tsPairs.filter((p) => !sqlPairs.includes(p))
    const extraInSql = sqlPairs.filter((p) => !tsPairs.includes(p))
    expect(missingFromSql).toEqual([])
    expect(extraInSql).toEqual([])
  })

  it('the SQL migration never mentions any interest key absent from the TS taxonomy (catches a typo\'d key slipping into either file)', () => {
    const validKeys = new Set(INTEREST_TAXONOMY.map((i) => i.key))
    const sqlAliasPairs = parseSqlPairs('insert into public.interest_topic_aliases', 'PROFILE_INTERESTS')
    for (const [key] of sqlAliasPairs) {
      expect(validKeys.has(key), `SQL references unknown interest key "${key}"`).toBe(true)
    }
  })
})

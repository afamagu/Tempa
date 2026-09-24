// Same convention as the other Safety migration tests — this repository
// cannot execute Postgres in CI, so the tracked SQL source is inspected
// directly. (The repair itself WAS executed once against a real
// PostgreSQL engine — PGlite, outside the repo — using the real
// persistence migration: a meaningful/warn evaluation raised 42702
// before the repair and succeeded after it, and the verifier below read
// overall_pass=false before and true after.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (name: string) => readFileSync(path.join(SQL_DIR, name), 'utf8').replace(/\r\n/g, '\n')

const canonical = read('2026-10-03-safety-persistence.sql')
const repair = read('2026-10-11-safety-record-evaluation-conflict-fix.sql')
const verify = read('2026-10-11-safety-record-evaluation-conflict-fix-verify.sql')

const stripLineComments = (text: string) => text.replace(/^\s*--.*$/gm, '')

function extractFunction(sql: string): string {
  const start = sql.indexOf('create or replace function public.record_safety_evaluation(')
  expect(start).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + '$function$;'.length)
}

const AMBIGUOUS = 'on conflict (evaluation_id) do nothing;'
const REPAIRED = 'on conflict on constraint safety_signals_evaluation_id_key do nothing;'

describe('record_safety_evaluation 42702 repair — forward-only, single-clause change', () => {
  it('is a new forward-only migration: one begin/commit, marked NOT EXECUTED, no DROP', () => {
    expect((repair.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((repair.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(repair).toContain('STATUS: NOT EXECUTED')
    expect(stripLineComments(repair).toLowerCase()).not.toMatch(/\bdrop\b/)
  })

  it('the historical persistence migration is left untouched (still carries the original clause)', () => {
    expect(extractFunction(canonical)).toContain(AMBIGUOUS)
  })

  it('removes the ambiguous conflict target and uses the named constraint instead', () => {
    const fn = extractFunction(repair)
    expect(fn).not.toContain(AMBIGUOUS)
    expect(fn).toContain(REPAIRED)
    expect(fn.split(REPAIRED).length - 1).toBe(1)
  })

  it('the repaired function is byte-for-byte the canonical definition except that ONE clause', () => {
    const fromCanonical = extractFunction(canonical).replace(AMBIGUOUS, REPAIRED)
    expect(extractFunction(repair)).toBe(fromCanonical)
  })

  it('same signature and return shape — CREATE OR REPLACE is an in-place replacement, never a new overload', () => {
    const header = (fn: string) => fn.slice(0, fn.indexOf('as $function$'))
    expect(header(extractFunction(repair))).toBe(header(extractFunction(canonical)))
    expect(header(extractFunction(repair))).toContain('returns table (')
    expect(header(extractFunction(repair))).toContain('security definer')
  })

  it('restates the exact service_role-only grants the canonical migration set', () => {
    const code = stripLineComments(repair)
    const sig = 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)'
    expect(code).toContain(`revoke all on function ${sig} from public;`)
    expect(code).toContain(`grant execute on function ${sig} to service_role;`)
    expect(code).not.toMatch(/grant execute on function public\.record_safety_evaluation[^;]*to (anon|authenticated)/)
  })

  it('contains no statement other than the function replacement and its grants', () => {
    const code = stripLineComments(repair).replace(/create or replace function[\s\S]*?\$function\$;/, '')
    const statements = code
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements).toEqual([
      'begin',
      'revoke all on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) from public',
      'grant execute on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) to service_role',
      'commit',
    ])
  })

  it('explains the 42702 / RETURNS TABLE collision and that it is a forward-only production repair', () => {
    expect(repair).toContain('42702')
    expect(repair).toContain('RETURNS TABLE')
    expect(repair).toContain('evaluation_id')
    expect(repair.toLowerCase()).toContain('forward-only')
  })
})

describe('repair verifier — read-only and proves the three required facts', () => {
  it('is read-only', () => {
    const code = stripLineComments(verify).replace(/'[^']*'/g, "''").toLowerCase()
    expect(code).not.toMatch(/\binsert\s+into\b/)
    expect(code).not.toMatch(/\bupdate\s+\w/)
    expect(code).not.toMatch(/\bdelete\s+from\b/)
    expect(code).not.toMatch(/\b(drop|alter|create|truncate|grant|revoke)\b/)
  })

  it('checks the ambiguous clause is gone, the ON CONSTRAINT clause is present, and the unique constraint exists', () => {
    expect(verify).toContain('ambiguous_conflict_target_gone')
    expect(verify).toContain('on_constraint_form_present')
    expect(verify).toContain('unique_constraint_exists')
    expect(verify).toContain("'safety_signals_evaluation_id_key'")
    expect(verify).toContain("'UNIQUE (evaluation_id)'")
    expect(verify).toContain('overall_pass')
  })

  it('its regexes distinguish the old and repaired clauses (whitespace/case tolerant, not comment-catching substrings)', () => {
    const grab = (name: string) => {
      const m = verify.match(new RegExp(`pg_get_functiondef\\(p\\.oid\\) ~\\* '([^']*)',\\s*false\\s*\\) as ${name}`))
      expect(m, `regex for ${name}`).not.toBeNull()
      return new RegExp(m![1], 'i')
    }
    const gone = grab('ambiguous_conflict_target_gone')
    const present = grab('on_constraint_form_present')

    const oldSql = 'insert into t (evaluation_id) values (1)\n    ON CONFLICT (evaluation_id)\n      DO NOTHING;'
    const newSql = 'insert into t (evaluation_id) values (1)\n    on conflict on constraint safety_signals_evaluation_id_key do nothing;'
    expect(gone.test(oldSql)).toBe(true) // old form is what "gone" searches for (verifier negates it)
    expect(gone.test(newSql)).toBe(false)
    expect(present.test(newSql)).toBe(true)
    expect(present.test(oldSql)).toBe(false)
  })
})

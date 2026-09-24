import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-04-reading-places.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-04-reading-places-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}

const codeOnly = stripLineComments(sql)

describe('Reading Places migration — automatic resume only', () => {
  it('is one transaction and remains explicitly not executed', () => {
    expect((sql.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })

  it('creates one self-scoped RLS table without raw content', () => {
    expect(codeOnly).toContain('create table public.reading_places')
    expect(codeOnly).toContain('alter table public.reading_places enable row level security')
    expect(codeOnly).toMatch(/using \(auth\.uid\(\) = user_id\)/)
    expect(codeOnly).toMatch(/with check \(auth\.uid\(\) = user_id\)/)
    expect(codeOnly).not.toMatch(/\bbody\s+text\b|\bcontent\s+text\b/)
  })

  it('stores only automatic resume state — no deliberate saved-place columns remain', () => {
    expect(codeOnly).toContain('resume_paragraph_index integer')
    expect(codeOnly).toContain('resume_char_offset integer')
    expect(codeOnly).toContain('resume_updated_at timestamptz')
    expect(codeOnly).not.toContain('saved_paragraph_index')
    expect(codeOnly).not.toContain('saved_char_offset')
    expect(codeOnly).not.toContain('saved_at')
  })

  it('does not modify dispatch_views', () => {
    expect(codeOnly).not.toMatch(/create table public\.dispatch_views|alter table public\.dispatch_views|drop table public\.dispatch_views/)
  })

  it('verifier is read-only and checks overall_pass plus absence of saved-place columns', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\bdrop\s+(table|function|index)\b|\balter\s+table\b/)
    expect(verifySql).toContain('no_deliberate_saved_place_columns')
    expect(verifySql).toContain('overall_pass')
  })
})

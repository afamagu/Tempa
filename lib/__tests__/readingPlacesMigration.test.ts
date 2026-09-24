// This repository cannot execute Postgres in CI, so every requirement
// that lives purely in SQL (grants/RLS/no raw content) is verified
// directly against the tracked migration source text — same convention
// as arrivalEmailQueueMigration.test.ts/safetyPersistenceMigration.test.ts.

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

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })

  it('is entirely separate from the Safety migrations — no safety_* table/function referenced', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/safety_evaluations|safety_signals|safety_cases|record_safety_evaluation/)
  })

  it('never modifies dispatch_views — Dispatch automatic resume stays exactly where it already lives', () => {
    expect(codeOnly).not.toMatch(/create table public\.dispatch_views/)
    expect(codeOnly).not.toMatch(/alter table public\.dispatch_views/)
    expect(codeOnly).not.toMatch(/drop table public\.dispatch_views/)
  })
})

describe('privacy — no Letter/Dispatch body text stored', () => {
  it('never declares a body/content/text column', () => {
    expect(codeOnly).not.toMatch(/\bbody\s+text\b/)
    expect(codeOnly).not.toMatch(/\bcontent\s+text\b/)
  })
})

describe('reading_places — one shared table for both content types, RLS scoped to the owning member only', () => {
  it('RLS is enabled with a single self-scoped policy, and every grant is revoked from public/anon first', () => {
    expect(codeOnly).toContain('alter table public.reading_places enable row level security')
    expect(codeOnly).toContain('revoke all on public.reading_places from public')
    expect(codeOnly).toMatch(/create policy reading_places_own\s+on public\.reading_places\s+for all\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\)/)
  })

  it('grants select/insert/update to authenticated, but not delete', () => {
    expect(codeOnly).toContain('grant select, insert, update on public.reading_places to authenticated')
    expect(codeOnly).not.toMatch(/grant[^;]*delete[^;]*on public\.reading_places/i)
  })

  it('constrains content_type to exactly letter and dispatch', () => {
    expect(codeOnly).toMatch(/content_type text not null\s+check \(content_type in \('letter', 'dispatch'\)\)/)
  })

  it('has a composite primary key of (user_id, content_type, content_id) — one row per member per content item', () => {
    expect(codeOnly).toMatch(/primary key \(user_id, content_type, content_id\)/)
  })

  it('has independent, nullable resume_* and saved_* column pairs — automatic resume and deliberate Saved place never share state', () => {
    expect(codeOnly).toMatch(/resume_paragraph_index integer\s+check \(resume_paragraph_index is null or resume_paragraph_index >= 0\)/)
    expect(codeOnly).toContain('resume_updated_at timestamptz,')
    expect(codeOnly).toMatch(/saved_paragraph_index integer\s+check \(saved_paragraph_index is null or saved_paragraph_index >= 0\)/)
    expect(codeOnly).toContain('saved_at timestamptz,')
  })

  it('has no default forcing 0 on either paragraph-index column — NULL means "never recorded", not "at the first paragraph"', () => {
    expect(codeOnly).not.toMatch(/resume_paragraph_index integer[^,]*default/)
    expect(codeOnly).not.toMatch(/saved_paragraph_index integer[^,]*default/)
  })

  it('has an intra-paragraph char-offset column for each anchor pair, structurally requiring the paragraph index whenever an offset is set (independent audit correction)', () => {
    expect(codeOnly).toMatch(/resume_char_offset integer\s+check \(resume_char_offset is null or resume_char_offset >= 0\)/)
    expect(codeOnly).toMatch(/saved_char_offset integer\s+check \(saved_char_offset is null or saved_char_offset >= 0\)/)
    expect(codeOnly).toContain('check (resume_char_offset is null or resume_paragraph_index is not null)')
    expect(codeOnly).toContain('check (saved_char_offset is null or saved_paragraph_index is not null)')
  })

  it('never stores a raw pixel scroll coordinate as the durable anchor', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/scroll_top|pixel_offset|scroll_position/)
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks the table this migration adds', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    expect(verifySql).toContain('reading_places')
    expect(verifySql).toContain('overall_pass')
  })
})

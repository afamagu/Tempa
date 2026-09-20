import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-20-letter-archive-removals.sql'),
  'utf8'
).toLowerCase()

describe('viewer-only letter archive removals', () => {
  it('stores only a viewer and letter suppression pair behind RLS', () => {
    expect(sql).toContain('create table if not exists public.letter_archive_removals')
    expect(sql).toContain('primary key (user_id, letter_id)')
    expect(sql).toContain('alter table public.letter_archive_removals enable row level security')
    expect(sql).toContain('using (user_id = auth.uid())')
  })

  it('does not grant members direct mutation access', () => {
    expect(sql).toContain('revoke all on public.letter_archive_removals from public, anon, authenticated')
    expect(sql).toContain('grant select on public.letter_archive_removals to authenticated')
    expect(sql).not.toMatch(/grant (insert|update|delete) on public\.letter_archive_removals/)
  })

  it('validates that every requested letter belongs to the caller', () => {
    expect(sql).toContain('l.sender_id = v_user_id or l.recipient_id = v_user_id')
    expect(sql).toContain('if v_allowed_count <> v_requested_count')
    expect(sql).toContain('on conflict (user_id, letter_id) do nothing')
  })
})

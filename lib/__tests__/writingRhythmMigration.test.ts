import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sql = readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-04-phase3-writing-rhythm.sql'),
  'utf8'
)
const lower = sql.toLowerCase()

describe('Phase 3 writing rhythm migration', () => {
  it('keeps existing members nullable rather than inventing a pace for them', () => {
    expect(lower).toContain('add column if not exists writing_rhythm text')
    expect(lower).not.toMatch(/writing_rhythm\s+text\s+not\s+null/)
    expect(lower).not.toMatch(/writing_rhythm\s+text[^;]*default\s+/)
  })

  it('allows exactly the four bounded rhythm keys', () => {
    for (const value of ['few_days', 'one_week', 'two_weeks', 'one_month']) {
      expect(sql).toContain(`'${value}'`)
    }
    expect(lower).not.toContain("'whenever'")
    expect(lower).not.toContain('when i have something to say')
  })

  it('maps canonical horizons to 4, 7, 14 and 30 days', () => {
    expect(sql).toContain("when 'few_days' then 4")
    expect(sql).toContain("when 'one_week' then 7")
    expect(sql).toContain("when 'two_weeks' then 14")
    expect(sql).toContain("when 'one_month' then 30")
  })

  it('stores per-correspondence overrides by correspondence and owner', () => {
    expect(lower).toContain('create table if not exists public.correspondence_rhythm_overrides')
    expect(lower).toContain('primary key (correspondence_id, user_id)')
    expect(lower).toContain('alter table public.correspondence_rhythm_overrides enable row level security')
  })

  it('requires an active established correspondence before an override can be changed', () => {
    expect(lower).toContain("c.status = 'active'")
    expect(lower).toContain('c.established_at is not null')
    expect(lower).toContain('(c.participant_low = auth.uid() or c.participant_high = auth.uid())')
  })

  it('exposes participant-only effective rhythm without exposing the override table to anon', () => {
    expect(lower).toContain('create or replace function public.get_correspondence_rhythm')
    expect(lower).toContain('revoke all on function public.get_correspondence_rhythm(uuid) from public, anon')
    expect(lower).toContain('grant execute on function public.get_correspondence_rhythm(uuid) to authenticated')
  })

  it('supports clearing one override back to the member default', () => {
    expect(lower).toContain('if p_rhythm is null then')
    expect(lower).toContain('delete from public.correspondence_rhythm_overrides')
  })
})

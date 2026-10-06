import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-06-phase13-private-memory.sql'),
  'utf8'
)

describe('Phase 13 Private Memory database contract', () => {
  it('stores memory per owner and per correspondence episode', () => {
    expect(migration).toContain('primary key (owner_id, correspondence_id)')
    expect(migration).toContain('references public.correspondences(id)')
    expect(migration).not.toContain('counterpart_id')
  })

  it('requires an established correspondence for reads and writes', () => {
    expect(migration).toContain('c.established_at is not null')
    expect(migration).toContain('v_uid in (c.participant_low, c.participant_high)')
  })

  it('keeps the table inaccessible directly to authenticated clients', () => {
    expect(migration).toContain('revoke all on table tempa_private.correspondence_private_memory')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).not.toContain('grant select')
    expect(migration).not.toContain('grant insert')
  })

  it('binds reads to the authenticated owner', () => {
    expect(migration).toContain('m.owner_id = v_uid')
    expect(migration).toContain('get_my_correspondence_private_memory')
  })

  it('bounds manual note length and exposes no extraction job', () => {
    expect(migration).toContain('char_length(p_note_text) > 4000')
    expect(migration.toLowerCase()).not.toContain('embedding')
    expect(migration.toLowerCase()).not.toContain('summarize')
    expect(migration.toLowerCase()).not.toContain('extract_letter')
  })

  it('does not touch discovery, ranking, reminders or profile metadata', () => {
    expect(migration).not.toContain('discover_people')
    expect(migration).not.toContain('board_feed')
    expect(migration).not.toContain('reply_reminder')
    expect(migration).not.toContain('public_profiles')
  })
})

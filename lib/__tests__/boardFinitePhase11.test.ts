import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-06-phase11-board-finite-rework.sql'),
  'utf8'
)

describe('Phase 11 Dispatch first-contact origin', () => {
  it('stores context beside the immutable Letter rather than changing letters', () => {
    expect(migration).toContain('create table if not exists public.dispatch_letter_contexts')
    expect(migration).toContain('letter_id uuid primary key')
    expect(migration).not.toContain('alter table public.letters add column dispatch')
  })

  it('uses a wrapper around the existing authoritative first-letter RPC', () => {
    expect(migration).toContain('create or replace function public.send_first_letter_from_dispatch')
    expect(migration).toContain('v_result := public.send_first_letter(')
  })

  it('accepts only public member Dispatches by the intended recipient', () => {
    expect(migration).toContain('d.author_id = p_recipient_id')
    expect(migration).toContain("d.status = 'published'")
    expect(migration).toContain("d.moderation_status = 'visible'")
    expect(migration).toContain("coalesce(d.published_as, 'member') = 'member'")
  })

  it('respects full-block/public-author visibility before the wrapper calls the private-letter authority', () => {
    expect(migration).toContain('tempa_private.is_blocked_pair')
    expect(migration).toContain('tempa_private.author_content_publicly_visible')
  })

  it('does not grant members a way to forge Dispatch context rows', () => {
    expect(migration).toContain('grant select')
    expect(migration).not.toContain('grant insert')
  })
})

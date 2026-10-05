import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-06-phase12-profile-rework.sql'),
  'utf8'
)

describe('Phase 12 profile correspondence metadata contract', () => {
  it('exposes only availability and writing rhythm, never capacity counts', () => {
    expect(migration).toContain('can_receive_first_contact boolean')
    expect(migration).toContain('writing_rhythm text')
    expect(migration).not.toContain('returns table (\n  active_limit')
    expect(migration).not.toContain('established_count integer')
    expect(migration).not.toContain('outgoing_pending_count integer')
  })

  it('reuses public profile visibility and canonical capacity state', () => {
    expect(migration).toContain('from public.public_profiles')
    expect(migration).toContain('tempa_private.relationship_capacity_state(p_user_id)')
  })

  it('keeps voluntary break and public-author visibility aligned', () => {
    expect(migration).toContain('tempa_private.author_content_publicly_visible(p_user_id)')
  })

  it('uses the existing inbound first-contact limit without exposing its count', () => {
    expect(migration).toContain('v_state.incoming_pending_count < v_state.incoming_pending_limit')
  })

  it('batches exact answer origins through the Phase 10 authority', () => {
    expect(migration).toContain('create or replace function public.get_profile_writable_answer_ids')
    expect(migration).toContain('public.room_answer_can_start_letter(a.id, p_user_id)')
  })

  it('keeps both reads authenticated-only', () => {
    expect(migration).toContain('revoke all on function public.get_public_profile_correspondence_state(uuid)')
    expect(migration).toContain('revoke all on function public.get_profile_writable_answer_ids(uuid, integer)')
    expect(migration).toContain('to authenticated')
  })
})

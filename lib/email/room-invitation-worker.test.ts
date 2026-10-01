import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderRoomInvitationEmail, runRoomInvitationEmailWorker } from './room-invitation-worker'

const snapshot = { from: 'Tempa <tempa@example.test>', to: 'member@example.test', pseudonym: 'Mia <script>', prompt: 'What do you think?', questionId: '00000000-0000-0000-0000-000000000101', siteOrigin: 'https://jointempa.com', idempotencyKey: 'room-invitation/event' }
describe('private Room invitation email', () => {
  it('escapes writing and links to the Question without including private correspondence', () => {
    const result = renderRoomInvitationEmail(snapshot)
    expect(result.html).toContain('Mia &lt;script&gt;')
    expect(result.html).not.toContain('<script>')
    expect(result.text).toContain('/question/00000000-0000-0000-0000-000000000101?source=room')
    expect(() => renderRoomInvitationEmail({ ...snapshot, siteOrigin: 'https://user:pass@evil.test/path' })).toThrow()
  })
  it('uses the frozen provider payload on retries and never sends a fenced-out job', async () => {
    vi.stubEnv('ARRIVAL_EMAIL_FROM', 'Tempa <tempa@example.test>')
    const frozen = { ...renderRoomInvitationEmail(snapshot), from: snapshot.from, to: snapshot.to, idempotencyKey: snapshot.idempotencyKey, html: 'Frozen HTML from the previous deployment' }
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'claim_room_invitation_emails') return { data: [{ invitation_id: 'first', claim_token: 'valid' }, { invitation_id: 'stale', claim_token: 'lost' }], error: null }
      if (fn === 'prepare_room_invitation_email') return { data: args.p_invitation_id === 'first' ? { ...snapshot, providerRequest: frozen } : null, error: null }
      if (fn === 'freeze_room_invitation_email') return { data: frozen, error: null }
      return { data: true, error: null }
    })
    const sendEmail = vi.fn(async () => ({ ok: true as const, providerMessageId: 'sent' }))
    const result = await runRoomInvitationEmailWorker({ supabase: { rpc } as unknown as SupabaseClient, sendEmail, siteOrigin: 'https://jointempa.com' })
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(frozen)
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 0 })
    vi.unstubAllEnvs()
  })
})

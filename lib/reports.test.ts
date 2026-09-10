import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportContent } from './reports'
import { createFakeReports } from './__tests__/simulateReportRpcs'

const SOURCE_PATH = path.join(__dirname, 'reports.ts')
const source = readFileSync(SOURCE_PATH, 'utf8')

const REPORTER = 'user-reporter'
const SENDER = 'user-sender'

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

describe('reportContent — thin RPC wrapper (pre-beta minimum safety build)', () => {
  it('rejects when unauthenticated', async () => {
    const fake = createFakeReports({ viewerId: null })
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Authentication required.')
  })

  it('a valid report succeeds', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'spam', 'Sent me a link.')
    expect(error).toBeNull()
    expect(fake._reports).toHaveLength(1)
  })

  it('rejects an unknown target type', async () => {
    const fake = createFakeReports({ viewerId: REPORTER })
    // @ts-expect-error deliberately invalid for this test
    const { error } = await reportContent(client(fake), 'comment', SENDER, 'spam', '')
    expect(error).not.toBeNull()
  })

  it('rejects an unknown reason', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: SENDER, pseudonym: 'Sender' }],
    })
    // @ts-expect-error deliberately invalid for this test
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'because', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Unknown report reason.')
  })

  it('rejects a target that does not exist', async () => {
    const fake = createFakeReports({ viewerId: REPORTER, profiles: [] })
    const { error } = await reportContent(client(fake), 'profile', 'nobody', 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Member not found.')
  })

  it('rejects reporting your own content (self-report)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }],
    })
    const { error } = await reportContent(client(fake), 'profile', REPORTER, 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('You cannot report your own content.')
  })

  it('rejects a second report of the same target by the same reporter (duplicate protection)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    await reportContent(client(fake), 'profile', SENDER, 'spam', '')
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'harassment', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('You have already reported this.')
    expect(fake._reports).toHaveLength(1)
  })

  it('a different reporter against the SAME target is not blocked by another reporter\'s duplicate guard', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: 'user-second-reporter', pseudonym: 'Second' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    await reportContent(client(fake), 'profile', SENDER, 'spam', '')

    fake._setViewer('user-second-reporter')
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'harassment', '')

    expect(error).toBeNull()
    expect(fake._reports).toHaveLength(2)
  })

  it('reported_user_id is derived server-side from the letter\'s sender, never from a client-supplied value', async () => {
    // The wrapper's own call signature has no reported-user parameter at
    // all — this is a structural guarantee, not just a runtime one.
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
    })
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    expect(fake._reports[0].reported_user_id).toBe(SENDER)
    expect(fake._reports[0].reported_user_id).not.toBe(REPORTER)
  })

  it('a non-participant cannot report a letter they are not party to', async () => {
    const fake = createFakeReports({
      viewerId: 'user-outsider',
      profiles: [{ id: SENDER, pseudonym: 'Sender' }],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
    })
    const { error } = await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Letter not found.')
  })

  it('reported_user_id for a photo Moment is derived from the letter it belongs to, not supplied by the caller', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
      moments: [{ id: 'moment-1', letter_id: 'letter-1', type: 'photo', image_path: 'letter-photos/x/y.jpg' }],
    })
    const { error } = await reportContent(client(fake), 'photo_moment', 'moment-1', 'inappropriate_content', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(SENDER)
  })

  it('trims context and sends null when blank, never an empty string', async () => {
    let capturedContext: unknown
    const fake = {
      async rpc(fn: string, params?: Record<string, unknown>) {
        capturedContext = params?.p_context
        return { data: null, error: null }
      },
    }
    await reportContent(fake as unknown as SupabaseClient, 'profile', SENDER, 'other', '   ')
    expect(capturedContext).toBeNull()
  })

  it('never touches blocking — reporting and blocking are fully independent actions', () => {
    expect(source).not.toContain('blocked_users')
    expect(source).not.toContain('block_user')
    expect(source).not.toContain("from '@/lib/blocking'")
  })

  it('the reason enum presents scam/fraud with the required international-platform wording', async () => {
    const { REPORT_REASONS } = await import('./reports')
    const scamFraud = REPORT_REASONS.find((r) => r.value === 'scam_fraud')
    expect(scamFraud?.label).toBe('Scam, fraud or money request')
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isStaff,
  setAccountStatus,
  listReports,
  getMember,
  markReportReviewed,
  listMembers,
  getReport,
  sendAdminFirstLetter,
  getArrivalEmailStatus,
  setArrivalEmailSendingEnabled,
} from './admin'
import { reportContent } from './reports'
import { createFakeReports } from './__tests__/simulateReportRpcs'

const STAFF = 'user-staff'
const MEMBER = 'user-member'
const REPORTER = 'user-reporter'

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

describe('admin_set_account_status — staff-only account enforcement', () => {
  it('a non-staff caller cannot call the admin status RPC', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }],
    })
    const { error } = await setAccountStatus(client(fake), MEMBER, 'restricted', 'testing')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Not authorized.')
    expect(fake._accountStatus.has(MEMBER)).toBe(false)
  })

  it('a staff caller can successfully change a member\'s account status', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    const { error } = await setAccountStatus(client(fake), MEMBER, 'suspended', 'Repeated scam reports.')
    expect(error).toBeNull()
    expect(fake._accountStatus.get(MEMBER)?.status).toBe('suspended')
  })

  it('a blank reason is rejected — no destructive action without a reason', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    const { error } = await setAccountStatus(client(fake), MEMBER, 'banned', '   ')
    expect(error).not.toBeNull()
    expect(fake._accountStatus.has(MEMBER)).toBe(false)
  })

  it('writes an audit entry alongside the status change', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    await setAccountStatus(client(fake), MEMBER, 'banned', 'Confirmed scam.')
    expect(fake._auditLog).toHaveLength(1)
    expect(fake._auditLog[0].action).toBe('set_account_status')
    expect(fake._auditLog[0].target_id).toBe(MEMBER)
    expect(fake._auditLog[0].metadata).toMatchObject({ old_status: 'active', new_status: 'banned' })
  })

  it('a rejected status change (invalid reason) never writes a status change OR an audit entry — atomic', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    const { error } = await setAccountStatus(client(fake), MEMBER, 'banned', '')
    expect(error).not.toBeNull()
    expect(fake._accountStatus.has(MEMBER)).toBe(false)
    expect(fake._auditLog).toHaveLength(0)
  })
})

describe('isStaff', () => {
  it('resolves true for a granted staff member', async () => {
    const fake = createFakeReports({ viewerId: STAFF, staff: { [STAFF]: 'moderator' } })
    expect(await isStaff(client(fake))).toBe(true)
  })

  it('resolves false for an ordinary member', async () => {
    const fake = createFakeReports({ viewerId: MEMBER })
    expect(await isStaff(client(fake))).toBe(false)
  })
})

describe('admin read RPCs — ordinary members cannot inspect reports', () => {
  it('an ordinary (non-staff) member cannot list the report queue', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
    })
    await reportContent(client(fake), 'profile', MEMBER, 'spam', '')

    const { data, error } = await listReports(client(fake))
    expect(error).not.toBeNull()
    expect(data).toEqual([])
  })

  it('a staff member CAN list the report queue', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Member' },
        { id: STAFF, pseudonym: 'Staffer' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    await reportContent(client(fake), 'profile', MEMBER, 'spam', '')

    fake._setViewer(STAFF)
    const { data, error } = await listReports(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].reportedPseudonym).toBe('Member')
  })

  it('a non-staff member cannot read another member\'s admin status/detail', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }],
    })
    const { data, error } = await getMember(client(fake), MEMBER)
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('a non-staff member cannot mark a report reviewed', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
    })
    await reportContent(client(fake), 'profile', MEMBER, 'spam', '')
    const { error } = await markReportReviewed(client(fake), fake._reports[0].id)
    expect(error).not.toBeNull()
    expect(fake._reports[0].status).toBe('open')
  })
})

describe('getReport — private-Letter evidence flow (report-driven, never a general Letters browser)', () => {
  it('authorized staff can retrieve a reported Letter\'s frozen evidence via admin_get_report', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: MEMBER, recipient_id: REPORTER, body: 'Upsetting content.' }],
      staff: { [STAFF]: 'moderator' },
    })
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', 'Please review this.')
    fake._setViewer(STAFF)

    const { data, error } = await getReport(client(fake), fake._reports[0].id)
    expect(error).toBeNull()
    expect(data?.targetType).toBe('letter')
    expect(data?.evidenceSnapshot).toMatchObject({ body: 'Upsetting content.', sender_pseudonym: 'Sender' })
    expect(data?.reportedPseudonym).toBe('Sender')
    expect(data?.reporterPseudonym).toBe('Reporter')
  })

  it('a non-staff caller cannot retrieve report evidence at all', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: MEMBER, recipient_id: REPORTER, body: 'Content.' }],
    })
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    const { data, error } = await getReport(client(fake), fake._reports[0].id)
    expect(error?.message).toBe('Not authorized.')
    expect(data).toBeNull()
  })

  it('there is no general Letters-browsing path: an arbitrary/unreported letter id has no report row and cannot be fetched via admin_get_report', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [{ id: STAFF, pseudonym: 'Staffer' }],
      staff: { [STAFF]: 'moderator' },
    })
    // No report was ever filed — admin_get_report only ever reads an
    // existing reports row by report id, never a letters row by letter
    // id, so a guessed/arbitrary id simply finds nothing.
    const { data, error } = await getReport(client(fake), 'some-unrelated-letter-id')
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

describe('listReports — Admin Operations Refinement: server-paginated, filterable, never unreachable past page 1', () => {
  function manyReportsFixture(count: number) {
    const profiles = [{ id: STAFF, pseudonym: 'Staffer' }, { id: REPORTER, pseudonym: 'Reporter' }]
    for (let i = 0; i < count; i++) profiles.push({ id: `member-${i}`, pseudonym: `Member ${i}` })
    return createFakeReports({ viewerId: REPORTER, profiles, staff: { [STAFF]: 'moderator' } })
  }

  it('never returns more than one page worth of rows, and Next reaches reports beyond the old hard limit of 50', async () => {
    const fake = manyReportsFixture(60)
    for (let i = 0; i < 60; i++) {
      await reportContent(client(fake), 'profile', `member-${i}`, 'spam', '')
    }
    fake._setViewer(STAFF)

    const page1 = await listReports(client(fake), { limit: 30, offset: 0 })
    expect(page1.error).toBeNull()
    expect(page1.data).toHaveLength(30)

    // Page 2 reaches reports #31-60 — unreachable at all under the old
    // unpaginated `limit 50` with no offset.
    const page2 = await listReports(client(fake), { limit: 30, offset: 30 })
    expect(page2.error).toBeNull()
    expect(page2.data).toHaveLength(30)

    const page1Ids = new Set(page1.data.map((r) => r.id))
    const page2Ids = new Set(page2.data.map((r) => r.id))
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false)
  })

  it('filters by status', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    await reportContent(client(fake), 'profile', MEMBER, 'spam', '')
    fake._setViewer(STAFF)
    await markReportReviewed(client(fake), fake._reports[0].id)

    fake._reports.push({
      id: 'report-2',
      reporter_user_id: REPORTER,
      reported_user_id: MEMBER,
      target_type: 'profile',
      target_id: MEMBER,
      reason: 'harassment',
      context: null,
      evidence_snapshot: {},
      status: 'open',
      created_at: new Date().toISOString(),
    })

    const { data } = await listReports(client(fake), { status: 'open' })
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('report-2')
  })

  it('filters by target type', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: MEMBER, pseudonym: 'Member' },
      ],
      letters: [{ id: 'letter-1', sender_id: MEMBER, recipient_id: REPORTER, body: 'hi' }],
      staff: { [STAFF]: 'moderator' },
    })
    await reportContent(client(fake), 'profile', MEMBER, 'spam', '')
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    fake._setViewer(STAFF)

    const { data } = await listReports(client(fake), { targetType: 'letter' })
    expect(data).toHaveLength(1)
    expect(data[0].targetType).toBe('letter')
  })

  it('rejects an invalid status filter', async () => {
    const fake = createFakeReports({ viewerId: STAFF, staff: { [STAFF]: 'moderator' } })
    const { error } = await client(fake).rpc('admin_list_reports', { p_status: 'not-a-real-status' })
    expect(error?.message).toBe('Invalid status filter.')
  })
})

describe('listMembers — Admin Operations Refinement: default paginated directory + filters', () => {
  it('a non-staff caller is refused', async () => {
    const fake = createFakeReports({ viewerId: MEMBER, profiles: [{ id: MEMBER, pseudonym: 'Member' }] })
    const { error } = await listMembers(client(fake))
    expect(error?.message).toBe('Not authorized.')
  })

  it('with no query, returns a default listing (newest first) rather than nothing', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer', created_at: '2025-01-01T00:00:00Z' },
        { id: 'm1', pseudonym: 'Older Member', created_at: '2026-01-01T00:00:00Z' },
        { id: 'm2', pseudonym: 'Newer Member', created_at: '2026-06-01T00:00:00Z' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    const { data, error } = await listMembers(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(3)
    expect(data[0].pseudonym).toBe('Newer Member')
    expect(data.at(-1)?.pseudonym).toBe('Staffer')
  })

  it('narrows by pseudonym query', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: 'm1', pseudonym: 'Autumn Fan' },
        { id: 'm2', pseudonym: 'Winter Fan' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    const { data } = await listMembers(client(fake), { query: 'autumn' })
    expect(data).toHaveLength(1)
    expect(data[0].pseudonym).toBe('Autumn Fan')
  })

  it('filters by account status', async () => {
    const fake = createFakeReports({
      viewerId: STAFF,
      profiles: [
        { id: STAFF, pseudonym: 'Staffer' },
        { id: 'm1', pseudonym: 'Restricted Member' },
        { id: 'm2', pseudonym: 'Active Member' },
      ],
      staff: { [STAFF]: 'moderator' },
    })
    await setAccountStatus(client(fake), 'm1', 'restricted', 'Testing filter.')

    const { data } = await listMembers(client(fake), { status: 'restricted' })
    expect(data).toHaveLength(1)
    expect(data[0].pseudonym).toBe('Restricted Member')
  })

  it('never fetches more than one page — limit is respected and clamped', async () => {
    const profiles = [{ id: STAFF, pseudonym: 'Staffer' }]
    for (let i = 0; i < 40; i++) profiles.push({ id: `m${i}`, pseudonym: `Member ${i}` })
    const fake = createFakeReports({ viewerId: STAFF, profiles, staff: { [STAFF]: 'moderator' } })

    const { data } = await listMembers(client(fake), { limit: 25 })
    expect(data).toHaveLength(25)
  })
})

describe('Admin member workspace additions', () => {
  it('maps the expanded staff-only member shape without exposing database naming to the page', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: MEMBER,
        pseudonym: 'Evening Quill',
        country: 'Ghana',
        status: 'active',
        status_reason: null,
        status_changed_at: null,
        email: 'member@example.test',
        region: 'Greater Accra',
        age_range: '35–44',
        gender: 'Prefer not to say',
        gender_custom: null,
        languages: ['English'],
        intent: ['Friendship'],
        created_at: '2026-09-01T00:00:00Z',
        mark_id: 'mark-1',
      }],
      error: null,
    })
    const result = await getMember({ rpc } as unknown as SupabaseClient, MEMBER)
    expect(result.data).toMatchObject({
      email: 'member@example.test',
      region: 'Greater Accra',
      ageRange: '35–44',
      languages: ['English'],
      intent: ['Friendship'],
      markId: 'mark-1',
    })
  })

  it('uses the dedicated staff first-contact RPC with only member id and letter body', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'letter-1', error: null })
    const result = await sendAdminFirstLetter(
      { rpc } as unknown as SupabaseClient,
      MEMBER,
      'A private note from Tempa staff.'
    )
    expect(rpc).toHaveBeenCalledWith('admin_send_first_letter', {
      p_member_id: MEMBER,
      p_body: 'A private note from Tempa staff.',
    })
    expect(result).toEqual({ data: 'letter-1', error: null })
  })
})

describe('getArrivalEmailStatus / setArrivalEmailSendingEnabled — Admin email-delivery status', () => {
  it('maps the RPC jsonb payload from snake_case to the camelCase shape the UI uses', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        sendingEnabled: false,
        counts: { pending: 2, sent: 5 },
        recent: [
          {
            id: 'queue-1',
            letter_id: 'letter-1',
            recipient_id: 'recipient-1',
            status: 'failed',
            attempts: 3,
            max_attempts: 5,
            last_error: 'Resend responded 500',
            skipped_reason: null,
            provider_message_id: null,
            created_at: '2026-10-01T00:00:00Z',
            sent_at: null,
            updated_at: '2026-10-01T00:05:00Z',
          },
        ],
      },
      error: null,
    })

    const { data, error } = await getArrivalEmailStatus({ rpc } as unknown as SupabaseClient)

    expect(rpc).toHaveBeenCalledWith('admin_get_arrival_email_status')
    expect(error).toBeNull()
    expect(data).toEqual({
      sendingEnabled: false,
      counts: { pending: 2, sent: 5 },
      recent: [
        {
          id: 'queue-1',
          letterId: 'letter-1',
          recipientId: 'recipient-1',
          status: 'failed',
          attempts: 3,
          maxAttempts: 5,
          lastError: 'Resend responded 500',
          skippedReason: null,
          providerMessageId: null,
          createdAt: '2026-10-01T00:00:00Z',
          sentAt: null,
          updatedAt: '2026-10-01T00:05:00Z',
        },
      ],
    })
  })

  it('maps a persisted providerMessageId through on a sent row', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        sendingEnabled: true,
        counts: { sent: 1 },
        recent: [
          {
            id: 'queue-2',
            letter_id: 'letter-2',
            recipient_id: 'recipient-2',
            status: 'sent',
            attempts: 1,
            max_attempts: 5,
            last_error: null,
            skipped_reason: null,
            provider_message_id: 'resend-abc-123',
            created_at: '2026-10-01T00:00:00Z',
            sent_at: '2026-10-01T00:00:05Z',
            updated_at: '2026-10-01T00:00:05Z',
          },
        ],
      },
      error: null,
    })

    const { data } = await getArrivalEmailStatus({ rpc } as unknown as SupabaseClient)

    expect(data?.recent[0].providerMessageId).toBe('resend-abc-123')
  })

  it('surfaces an error from a non-staff caller rather than throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Staff access required.', code: '42501' } })
    const { data, error } = await getArrivalEmailStatus({ rpc } as unknown as SupabaseClient)
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'Staff access required.', code: '42501' })
  })

  it('setArrivalEmailSendingEnabled calls the RPC with the requested value', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const { error } = await setArrivalEmailSendingEnabled({ rpc } as unknown as SupabaseClient, true)
    expect(rpc).toHaveBeenCalledWith('set_arrival_email_sending_enabled', { p_enabled: true })
    expect(error).toBeNull()
  })
})

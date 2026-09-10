import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isStaff, setAccountStatus, listReports, getMember, markReportReviewed } from './admin'
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

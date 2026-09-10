import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getOverviewCounts,
  getOverviewDailySeries,
  mapOverviewCountsRow,
  mapDailySeriesRows,
  windowSeries,
  trailingAverage,
  detectSpike,
  buildAttentionItems,
  type DailySeriesPoint,
} from './admin-overview'
import { createFakeAdminOverview, type FakeLetter } from './__tests__/simulateAdminOverviewRpc'

const STAFF = 'user-staff'
const MEMBER = 'user-member'

function client(fake: ReturnType<typeof createFakeAdminOverview>) {
  return fake as unknown as SupabaseClient
}

describe('admin_overview_counts — staff-only aggregate access', () => {
  it('a non-staff caller is denied', async () => {
    const fake = createFakeAdminOverview({ viewerId: MEMBER })
    const { data, error } = await getOverviewCounts(client(fake))
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Not authorized.')
    expect(data).toBeNull()
  })

  it('a staff caller succeeds and receives mapped, camelCase aggregates', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      profiles: [{ id: STAFF }],
    })
    const { data, error } = await getOverviewCounts(client(fake))
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data?.totalMembers).toBe(1)
  })
})

describe('admin_overview_counts — first-letter definition (locked)', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  function baseLetter(overrides: Partial<FakeLetter>): FakeLetter {
    return {
      id: 'l',
      sender_id: 'a',
      correspondence_id: 'c-1',
      reply_to_id: null,
      question_answer_id: null,
      created_at: now.toISOString(),
      deliver_at: now.toISOString(),
      ...overrides,
    }
  }

  it('counts a genuine first-contact letter (reply_to_id null AND question_answer_id set)', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [baseLetter({ id: 'l-1', question_answer_id: 'qa-1' })],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.firstLetters).toBe(1)
  })

  it('does NOT count a Write Anytime letter (reply_to_id null but question_answer_id also null) as a first letter', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [
        baseLetter({ id: 'l-1', question_answer_id: 'qa-1' }), // genuine first letter
        baseLetter({ id: 'l-2', reply_to_id: null, question_answer_id: null }), // Write Anytime quill letter
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.firstLetters).toBe(1)
  })

  it('does not count an ordinary reply (reply_to_id set) as a first letter', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [baseLetter({ id: 'l-1', reply_to_id: 'l-0', question_answer_id: null })],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.firstLetters).toBe(0)
  })
})

describe('admin_overview_counts — letters currently travelling', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('counts only letters whose deliver_at is strictly in the future', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [
        {
          id: 'l-future',
          sender_id: 'a',
          correspondence_id: 'c-1',
          reply_to_id: null,
          question_answer_id: null,
          created_at: now.toISOString(),
          deliver_at: new Date(now.getTime() + 3_600_000).toISOString(),
        },
        {
          id: 'l-past',
          sender_id: 'a',
          correspondence_id: 'c-1',
          reply_to_id: null,
          question_answer_id: null,
          created_at: now.toISOString(),
          deliver_at: new Date(now.getTime() - 3_600_000).toISOString(),
        },
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.lettersTravelling).toBe(1)
  })
})

describe('admin_overview_counts — engaged correspondence thresholds', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  function letterIn(correspondenceId: string, id: string) {
    return {
      id,
      sender_id: 'a',
      correspondence_id: correspondenceId,
      reply_to_id: null,
      question_answer_id: null,
      created_at: now.toISOString(),
      deliver_at: now.toISOString(),
    }
  }

  it('counts correspondences with 2+ letters, excluding a 1-letter correspondence', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [letterIn('c-1', 'l-1'), letterIn('c-1', 'l-2'), letterIn('c-2', 'l-3')],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.correspondences2Plus).toBe(1)
  })

  it('counts correspondences with 5+ letters separately from 2+', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      letters: [
        letterIn('c-1', 'l-1'),
        letterIn('c-1', 'l-2'),
        letterIn('c-1', 'l-3'),
        letterIn('c-1', 'l-4'),
        letterIn('c-1', 'l-5'),
        letterIn('c-2', 'l-6'),
        letterIn('c-2', 'l-7'),
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.correspondences2Plus).toBe(2)
    expect(data?.correspondences5Plus).toBe(1)
  })
})

describe('admin_overview_counts — reports and account-status totals', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('splits open vs reviewed reports correctly', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      reports: [
        { status: 'open', created_at: now.toISOString() },
        { status: 'open', created_at: now.toISOString() },
        { status: 'reviewed', created_at: now.toISOString() },
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.openReports).toBe(2)
    expect(data?.reviewedReportsTotal).toBe(1)
  })

  it('tallies restricted/suspended/banned member counts independently', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      accountStatus: [
        { user_id: 'a', status: 'restricted' },
        { user_id: 'b', status: 'suspended' },
        { user_id: 'c', status: 'suspended' },
        { user_id: 'd', status: 'banned' },
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.restrictedMembers).toBe(1)
    expect(data?.suspendedMembers).toBe(2)
    expect(data?.bannedMembers).toBe(1)
  })
})

describe('admin_overview_counts — Photo Moments span all of TEMPA (letters + Dispatches)', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('sums letter Photo Moments and Dispatch Photo Moments into one total', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      moments: [
        { type: 'photo', created_at: now.toISOString() },
        { type: 'photo', created_at: now.toISOString() },
      ],
      dispatchMoments: [{ created_at: now.toISOString() }],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.photoMomentsTotal).toBe(3)
  })

  it('never counts a historical Postcard Moment (moments.type=\'postcard\') as a photo', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      moments: [
        { type: 'photo', created_at: now.toISOString() },
        { type: 'postcard', created_at: now.toISOString() },
        { type: 'postcard', created_at: now.toISOString() },
      ],
      dispatchMoments: [],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.photoMomentsTotal).toBe(1)
  })

  it('the 7-day figure also sums both sources, each independently windowed', async () => {
    const old = new Date(now.getTime() - 20 * 86_400_000).toISOString()
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      moments: [
        { type: 'photo', created_at: now.toISOString() }, // within 7d
        { type: 'photo', created_at: old }, // outside 7d
      ],
      dispatchMoments: [
        { created_at: now.toISOString() }, // within 7d
        { created_at: old }, // outside 7d
      ],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data?.photoMoments7d).toBe(2)
    expect(data?.photoMomentsTotal).toBe(4)
  })
})

describe('admin_overview_counts — no private content fields returned', () => {
  it('the mapped OverviewCounts shape contains only aggregate numbers, never a body/text field', async () => {
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      profiles: [{ id: STAFF }],
    })
    const { data } = await getOverviewCounts(client(fake))
    expect(data).not.toBeNull()
    const values = Object.entries(data as unknown as Record<string, unknown>)
    for (const [key, value] of values) {
      expect(typeof value).toBe('number')
      expect(key.toLowerCase()).not.toContain('body')
      expect(key.toLowerCase()).not.toContain('email')
      expect(key.toLowerCase()).not.toContain('pseudonym')
    }
  })
})

describe('admin_overview_daily_series — staff gate, buckets, and windows', () => {
  it('a non-staff caller is denied', async () => {
    const fake = createFakeAdminOverview({ viewerId: MEMBER })
    const { data, error } = await getOverviewDailySeries(client(fake))
    expect(error).not.toBeNull()
    expect(data).toEqual([])
  })

  it('buckets letters/reports/correspondences/signups by their own calendar day', async () => {
    const now = new Date('2026-09-10T18:00:00Z')
    const fake = createFakeAdminOverview({
      viewerId: STAFF,
      staff: { [STAFF]: 'moderator' },
      now,
      authUsers: [{ id: 'm-1', created_at: '2026-09-09T08:00:00Z' }],
      profiles: [{ id: 'm-1' }],
      letters: [
        {
          id: 'l-1',
          sender_id: 'a',
          correspondence_id: 'c-1',
          reply_to_id: null,
          question_answer_id: null,
          created_at: '2026-09-10T09:00:00Z',
          deliver_at: '2026-09-10T09:00:00Z',
        },
      ],
      reports: [{ status: 'open', created_at: '2026-09-08T00:00:00Z' }],
    })
    const { data } = await getOverviewDailySeries(client(fake), 5)
    expect(data).toHaveLength(5)
    const day10 = data.find((d) => d.day === '2026-09-10')
    const day09 = data.find((d) => d.day === '2026-09-09')
    const day08 = data.find((d) => d.day === '2026-09-08')
    expect(day10?.lettersSent).toBe(1)
    expect(day09?.newMembers).toBe(1)
    expect(day08?.reports).toBe(1)
  })

  it('returns exactly `days` rows, zero-filled for a quiet day', async () => {
    const fake = createFakeAdminOverview({ viewerId: STAFF, staff: { [STAFF]: 'moderator' } })
    const { data } = await getOverviewDailySeries(client(fake), 7)
    expect(data).toHaveLength(7)
    expect(data.every((d) => d.lettersSent === 0 && d.newMembers === 0 && d.reports === 0 && d.newCorrespondences === 0)).toBe(true)
  })
})

describe('mapOverviewCountsRow / mapDailySeriesRows — pure snake_case → camelCase mapping', () => {
  it('maps every field, including the exact "members who wrote in the last 7 days" figure', () => {
    const row = {
      total_members: 10,
      new_members_today: 1,
      new_members_7d: 2,
      new_members_30d: 3,
      letters_sent_today: 4,
      letters_sent_7d: 5,
      letters_sent_30d: 6,
      letters_travelling: 7,
      total_correspondences: 8,
      new_correspondences_7d: 9,
      first_letters: 10,
      correspondences_2plus: 11,
      correspondences_5plus: 12,
      members_wrote_7d: 13,
      open_reports: 14,
      reports_today: 15,
      reviewed_reports_total: 16,
      restricted_members: 17,
      suspended_members: 18,
      banned_members: 19,
      published_dispatches_total: 20,
      published_dispatches_7d: 21,
      photo_moments_total: 22,
      photo_moments_7d: 23,
      postcards_sent_total: 24,
      postcards_sent_7d: 25,
      living_postcards_total: 26,
    }
    const mapped = mapOverviewCountsRow(row)
    expect(mapped.membersWrote7d).toBe(13)
    expect(mapped.totalMembers).toBe(10)
    expect(mapped.livingPostcardsTotal).toBe(26)
  })

  it('maps daily series rows', () => {
    const mapped = mapDailySeriesRows([
      { day: '2026-09-10', new_members: 1, letters_sent: 2, new_correspondences: 3, reports: 4 },
    ])
    expect(mapped).toEqual([{ day: '2026-09-10', newMembers: 1, lettersSent: 2, newCorrespondences: 3, reports: 4 }])
  })
})

function point(day: string, value: number): DailySeriesPoint {
  return { day, newMembers: value, lettersSent: value, newCorrespondences: value, reports: value }
}

describe('windowSeries — pure 7d/30d windowing', () => {
  const series = Array.from({ length: 30 }, (_, i) => point(`day-${i}`, i))

  it('returns the last 7 points for a 7-day window', () => {
    const windowed = windowSeries(series, 7)
    expect(windowed).toHaveLength(7)
    expect(windowed[0].day).toBe('day-23')
    expect(windowed[6].day).toBe('day-29')
  })

  it('returns the whole series when the window is >= its length', () => {
    expect(windowSeries(series, 30)).toHaveLength(30)
    expect(windowSeries(series, 90)).toHaveLength(30)
  })
})

describe('trailingAverage / detectSpike — transparent spike rule', () => {
  it('excludes today from its own trailing average', () => {
    const series = [point('d1', 1), point('d2', 1), point('d3', 100)] // d3 = today
    expect(trailingAverage(series, 'reports')).toBe(1)
  })

  it('flags a spike only when today is both >= 2x the trailing average AND >= the absolute floor of 3', () => {
    const quietBaseline = [point('d1', 0), point('d2', 0), point('d3', 0), point('d4', 1)] // avg 0, today 1
    expect(detectSpike(quietBaseline, 'reports').isSpike).toBe(false) // below the floor of 3

    const genuineSpike = [
      point('d1', 2),
      point('d2', 2),
      point('d3', 2),
      point('d4', 2),
      point('d5', 2),
      point('d6', 2),
      point('d7', 2),
      point('d8', 10), // today: 10 >= 2*2 and >= 3
    ]
    expect(detectSpike(genuineSpike, 'reports').isSpike).toBe(true)

    const belowMultiplier = [point('d1', 5), point('d2', 5), point('d3', 6)] // today 6 is not >= 2*5
    expect(detectSpike(belowMultiplier, 'reports').isSpike).toBe(false)
  })

  it('never spikes on an empty series', () => {
    expect(detectSpike([], 'newMembers')).toEqual({ isSpike: false, today: 0, trailingAverage: 0 })
  })
})

describe('buildAttentionItems — restrained Needs Attention list', () => {
  const noSpike = { isSpike: false, today: 0, trailingAverage: 0 }

  it('returns an empty list when nothing needs attention — the UI shows "No immediate issues." for this', () => {
    const items = buildAttentionItems({
      openReports: 0,
      restrictedMembers: 0,
      suspendedMembers: 0,
      bannedMembers: 0,
      signupSpike: noSpike,
      reportSpike: noSpike,
    })
    expect(items).toEqual([])
  })

  it('surfaces open reports linked to the report queue', () => {
    const items = buildAttentionItems({
      openReports: 3,
      restrictedMembers: 0,
      suspendedMembers: 0,
      bannedMembers: 0,
      signupSpike: noSpike,
      reportSpike: noSpike,
    })
    expect(items).toHaveLength(1)
    expect(items[0].href).toBe('/admin/reports')
    expect(items[0].label).toContain('3 open reports')
  })

  it('never fabricates a stuck-delivery, email, or storage attention item — those are not instrumented', () => {
    const items = buildAttentionItems({
      openReports: 1,
      restrictedMembers: 0,
      suspendedMembers: 0,
      bannedMembers: 0,
      signupSpike: noSpike,
      reportSpike: noSpike,
    })
    const allText = items.map((i) => `${i.label} ${i.detail}`).join(' ').toLowerCase()
    expect(allText).not.toContain('stuck')
    expect(allText).not.toContain('email')
    expect(allText).not.toContain('storage')
  })
})

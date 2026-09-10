import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import AdminOverview from './overview-client'
import type { OverviewCounts, DailySeriesPoint } from '@/lib/admin-overview'

const SOURCE_PATH = path.join(__dirname, 'overview-client.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

const EMPTY_COUNTS: OverviewCounts = {
  totalMembers: 0,
  newMembersToday: 0,
  newMembers7d: 0,
  newMembers30d: 0,
  lettersSentToday: 0,
  lettersSent7d: 0,
  lettersSent30d: 0,
  lettersTravelling: 0,
  totalCorrespondences: 0,
  newCorrespondences7d: 0,
  firstLetters: 0,
  correspondences2Plus: 0,
  correspondences5Plus: 0,
  membersWrote7d: 0,
  openReports: 0,
  reportsToday: 0,
  reviewedReportsTotal: 0,
  restrictedMembers: 0,
  suspendedMembers: 0,
  bannedMembers: 0,
  publishedDispatchesTotal: 0,
  publishedDispatches7d: 0,
  photoMomentsTotal: 0,
  photoMoments7d: 0,
  postcardsSentTotal: 0,
  postcardsSent7d: 0,
  livingPostcardsTotal: 0,
}

const EMPTY_SERIES: DailySeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-09-${String(i + 1).padStart(2, '0')}`,
  newMembers: 0,
  lettersSent: 0,
  newCorrespondences: 0,
  reports: 0,
}))

// setInterval/visibilitychange lifecycle can't be exercised by
// renderToStaticMarkup (no real DOM/timer loop) — same established
// convention as app/admin/layout.test.ts: verified by source
// inspection instead.
describe('AdminOverview — periodic refresh lifecycle (source)', () => {
  it('polls on a 45-second interval, never more aggressively', () => {
    expect(source).toContain('const REFRESH_INTERVAL_MS = 45_000')
    expect(source).toContain('window.setInterval(refresh, REFRESH_INTERVAL_MS)')
  })

  it('pauses polling when the page is hidden, and resumes (with an immediate refresh) when visible again', () => {
    expect(source).toContain('document.hidden')
    expect(source).toContain('stopPolling()')
    expect(source).toContain("document.addEventListener('visibilitychange'")
  })

  it('cleans up the interval and listener on unmount', () => {
    const effectStart = source.indexOf('useEffect(() => {\n    let intervalId')
    expect(effectStart).toBeGreaterThan(-1)
    const effectBody = source.slice(effectStart, source.indexOf('}, [refresh])', effectStart))
    expect(effectBody).toContain('return () => {')
    expect(effectBody).toContain('stopPolling()')
    expect(effectBody).toContain("document.removeEventListener('visibilitychange'")
  })

  it('a background refresh failure never blanks already-rendered data — it only sets an error message', () => {
    expect(source).toContain('setError(countsResult.error.message)')
    expect(source).not.toContain('setCounts(null)')
  })

  it('offers a manual refresh control, disabled while a refresh is already in flight', () => {
    expect(source).toContain('onClick={() => void refresh()}')
    expect(source).toContain('disabled={refreshing}')
  })

  it('never subscribes directly to private letters/correspondences — only the two staff aggregate RPCs', () => {
    expect(source).toContain('getOverviewCounts')
    expect(source).toContain('getOverviewDailySeries')
    expect(source).not.toContain('.channel(')
    expect(source).not.toContain("from('letters')")
    expect(source).not.toContain("from('correspondences')")
  })
})

describe('AdminOverview — rendering', () => {
  it('renders a calm "not available yet" state without crashing when no data is available', () => {
    const html = renderToStaticMarkup(
      <AdminOverview initialCounts={null} initialSeries={[]} initialError={null} />
    )
    expect(html).toContain('Overview')
    expect(html).toContain('not available yet')
  })

  it('surfaces the actual error message when the initial fetch failed', () => {
    const html = renderToStaticMarkup(
      <AdminOverview initialCounts={null} initialSeries={[]} initialError="Not authorized." />
    )
    expect(html).toContain('Not authorized.')
  })

  it('renders every required section with populated data, and shows the restrained positive state when nothing needs attention', () => {
    const html = renderToStaticMarkup(
      <AdminOverview initialCounts={EMPTY_COUNTS} initialSeries={EMPTY_SERIES} initialError={null} />
    )
    expect(html).toContain('Needs attention')
    expect(html).toContain('No immediate issues.')
    expect(html).toContain('Members')
    expect(html).toContain('Writing')
    expect(html).toContain('Safety')
    expect(html).toContain('Review reports')
    expect(html).toContain('Find member')
    expect(html).toContain('Trends')
    expect(html).toContain('Board, Moments')
  })

  it('the exact literal label "Members who wrote in the last 7 days" is used — never a generic "Active members" claim', () => {
    const html = renderToStaticMarkup(
      <AdminOverview initialCounts={EMPTY_COUNTS} initialSeries={EMPTY_SERIES} initialError={null} />
    )
    expect(html).toContain('Members who wrote in the last 7 days')
    expect(html).not.toMatch(/>Active members</)
    expect(html).not.toMatch(/>Active users</)
  })

  it('surfaces an attention item (with its href) when there are open reports', () => {
    const html = renderToStaticMarkup(
      <AdminOverview
        initialCounts={{ ...EMPTY_COUNTS, openReports: 2 }}
        initialSeries={EMPTY_SERIES}
        initialError={null}
      />
    )
    expect(html).toContain('2 open reports')
    expect(html).toContain('/admin/reports')
  })
})

describe('AdminOverview — mobile-safe layout (source)', () => {
  it('stat groups use a responsive grid (2 columns on mobile), never a wide fixed table', () => {
    expect(source).toContain('grid grid-cols-2')
    expect(source).not.toContain('<table')
    expect(source).not.toContain('overflow-x-auto')
  })

  it('quick actions wrap naturally rather than forcing horizontal scroll', () => {
    expect(source).toContain('flex flex-wrap gap-2')
  })

  it('section order matches the Mobile Admin priority: attention, counters, quick actions, charts, secondary signals', () => {
    const order = [
      source.indexOf('<NeedsAttention'),
      source.indexOf('<StatGroup'),
      source.indexOf('<QuickActions'),
      source.indexOf('<ChartsSection'),
      source.indexOf('<SecondarySignals'),
    ]
    expect(order.every((i) => i > -1)).toBe(true)
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }
  })
})

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  getOverviewCounts,
  getOverviewDailySeries,
  windowSeries,
  detectSpike,
  buildAttentionItems,
  type OverviewCounts,
  type DailySeriesPoint,
  type SeriesMetricKey,
  type AttentionItem,
} from '@/lib/admin-overview'
import { sectionLabelClass, sectionTitleClass, helperTextClass, secondaryButtonClass, metadataTextClass } from '@/app/profile/ui'
import { formatDateTimeCompact } from '@/lib/format-date'
import OverviewChart from './overview-chart'

// The owner may leave this open on a dedicated monitor all day — 45s
// keeps it reasonably fresh without hammering the two aggregate RPCs.
// Deliberately not Realtime (Phase 2, and only once the relevant
// tables have a reviewed staff RLS policy of their own — see the
// Phase 1 audit).
const REFRESH_INTERVAL_MS = 45_000

function StatGroup({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <p className={sectionLabelClass}>{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label}>
            <p className="text-[20px] font-medium leading-tight text-foreground">{item.value.toLocaleString()}</p>
            <p className={helperTextClass}>{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-foreground/10 p-4">
        <p className={sectionLabelClass}>Needs attention</p>
        <p className={`mt-2 ${helperTextClass}`}>No immediate issues.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-accent/25 bg-accent/[.03] p-4">
      <p className={sectionLabelClass}>Needs attention</p>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            {item.href ? (
              <Link
                href={item.href}
                className="text-[14px] font-medium text-foreground underline decoration-foreground/25 underline-offset-4 hover:text-accent"
              >
                {item.label}
              </Link>
            ) : (
              <p className="text-[14px] font-medium text-foreground">{item.label}</p>
            )}
            <span className={metadataTextClass}>{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/admin/moderation/reports" className={secondaryButtonClass}>
        Review reports
      </Link>
      <Link href="/admin/members" className={secondaryButtonClass}>
        Find member
      </Link>
    </div>
  )
}

const CHART_METRICS: { key: SeriesMetricKey; title: string }[] = [
  { key: 'newMembers', title: 'New members' },
  { key: 'lettersSent', title: 'Letters sent' },
  { key: 'newCorrespondences', title: 'New correspondences' },
  { key: 'reports', title: 'Reports' },
]

function ChartsSection({ series }: { series: DailySeriesPoint[] }) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7)
  const windowed = windowSeries(series, windowDays)

  return (
    <div className="space-y-4 rounded-md border border-foreground/10 p-4">
      <div className="flex items-center justify-between">
        <p className={sectionLabelClass}>Trends</p>
        <div className="flex gap-1">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              aria-pressed={windowDays === d}
              className={`rounded px-2 py-1 text-[14px] font-medium transition-colors ${
                windowDays === d ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {CHART_METRICS.map((m) => (
          <OverviewChart
            key={m.key}
            title={m.title}
            total={windowed.reduce((total, p) => total + p[m.key], 0)}
            points={windowed.map((p) => ({ day: p.day, value: p[m.key] }))}
          />
        ))}
      </div>
    </div>
  )
}

function SecondarySignals({ counts }: { counts: OverviewCounts }) {
  const items = [
    { label: 'Published Dispatches', value: counts.publishedDispatchesTotal, sub: `${counts.publishedDispatches7d} in the last 7 days` },
    { label: 'Photo Moments', value: counts.photoMomentsTotal, sub: `${counts.photoMoments7d} in the last 7 days` },
    { label: 'Postcards sent', value: counts.postcardsSentTotal, sub: `${counts.postcardsSent7d} in the last 7 days` },
    { label: 'Living Postcards', value: counts.livingPostcardsTotal, sub: null as string | null },
  ]
  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <p className={sectionLabelClass}>Board, Moments &amp; Postcards</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label}>
            <p className="text-[16px] font-medium text-foreground">{item.value.toLocaleString()}</p>
            <p className={helperTextClass}>{item.label}</p>
            {item.sub && <p className="text-[13px] text-muted">{item.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The Overview / Command Center landing page (app/admin/page.tsx server
 * component fetches the FIRST paint's worth of data server-side and
 * hands it here as `initial*` props — this component owns everything
 * after that: periodic refresh, pause-when-hidden, manual refresh, and
 * every section's rendering. Section order matches the Mobile Admin
 * priority from the Phase 1 audit exactly (Needs attention → core
 * counters → quick actions → charts → secondary signals) — deliberately
 * the SAME order on desktop, one layout, not two.
 */
export default function AdminOverview({
  initialCounts,
  initialSeries,
  initialError,
}: {
  initialCounts: OverviewCounts | null
  initialSeries: DailySeriesPoint[]
  initialError: string | null
}) {
  const [counts, setCounts] = useState(initialCounts)
  const [series, setSeries] = useState(initialSeries)
  const [error, setError] = useState(initialError)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(initialCounts ? new Date() : null)
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)

    const supabase = createClient()
    const [countsResult, seriesResult] = await Promise.all([
      getOverviewCounts(supabase),
      getOverviewDailySeries(supabase, 30),
    ])

    // A background refresh error never blanks an already-populated
    // screen — the owner keeps looking at the last good data, with a
    // quiet note that the latest refresh failed, not a broken page.
    if (countsResult.error) {
      setError(countsResult.error.message)
    } else if (seriesResult.error) {
      setError(seriesResult.error.message)
    } else {
      setError(null)
      if (countsResult.data) setCounts(countsResult.data)
      setSeries(seriesResult.data)
      setLastUpdated(new Date())
    }

    refreshingRef.current = false
    setRefreshing(false)
  }, [])

  useEffect(() => {
    let intervalId: number | null = null

    function startPolling() {
      if (intervalId !== null) return
      intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    }
    function stopPolling() {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling()
      } else {
        // A monitor left open overnight shouldn't show stale data the
        // instant someone actually looks at it again.
        void refresh()
        startPolling()
      }
    }

    if (!document.hidden) startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refresh])

  if (!counts) {
    return (
      <div className="space-y-4">
        <h1 className={sectionTitleClass}>Overview</h1>
        <p className={helperTextClass}>
          {error ?? 'Overview data is not available yet.'}
        </p>
      </div>
    )
  }

  const signupSpike = detectSpike(series, 'newMembers')
  const reportSpike = detectSpike(series, 'reports')
  const attentionItems = buildAttentionItems({
    openReports: counts.openReports,
    restrictedMembers: counts.restrictedMembers,
    suspendedMembers: counts.suspendedMembers,
    bannedMembers: counts.bannedMembers,
    signupSpike,
    reportSpike,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className={sectionTitleClass}>Overview</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <p className={helperTextClass}>
              {refreshing ? 'Refreshing…' : `Updated ${formatDateTimeCompact(lastUpdated.toISOString())}`}
            </p>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-[13px] font-medium text-foreground/70 underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-red-600">Latest refresh failed: {error}</p>}

      <NeedsAttention items={attentionItems} />

      <div className="space-y-4">
        <StatGroup
          title="Members"
          items={[
            { label: 'Total members', value: counts.totalMembers },
            { label: 'New today', value: counts.newMembersToday },
            { label: 'New last 7 days', value: counts.newMembers7d },
            { label: 'New last 30 days', value: counts.newMembers30d },
          ]}
        />
        <StatGroup
          title="Writing & correspondence"
          items={[
            { label: 'Letters sent today', value: counts.lettersSentToday },
            { label: 'Letters sent last 7 days', value: counts.lettersSent7d },
            { label: 'Letters sent last 30 days', value: counts.lettersSent30d },
            { label: 'Letters currently travelling', value: counts.lettersTravelling },
            { label: 'Total correspondences', value: counts.totalCorrespondences },
            { label: 'New correspondences (7d)', value: counts.newCorrespondences7d },
            { label: 'First letters', value: counts.firstLetters },
            { label: 'Correspondences with 2+ letters', value: counts.correspondences2Plus },
            { label: 'Correspondences with 5+ letters', value: counts.correspondences5Plus },
            { label: 'Members who wrote in the last 7 days', value: counts.membersWrote7d },
          ]}
        />
        <StatGroup
          title="Safety"
          items={[
            { label: 'Open reports', value: counts.openReports },
            { label: 'Reports today', value: counts.reportsToday },
            { label: 'Reviewed reports (total)', value: counts.reviewedReportsTotal },
            { label: 'Restricted members', value: counts.restrictedMembers },
            { label: 'Suspended members', value: counts.suspendedMembers },
            { label: 'Banned members', value: counts.bannedMembers },
          ]}
        />
      </div>

      <QuickActions />

      <ChartsSection series={series} />

      <SecondarySignals counts={counts} />
    </div>
  )
}

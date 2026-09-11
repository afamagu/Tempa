import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listReports } from '@/lib/admin'
import type { ReportReason, ReportTargetType } from '@/lib/reports'
import { REPORT_REASONS } from '@/lib/reports'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, helperTextClass, metadataTextClass, pillClass } from '@/app/profile/ui'

const PAGE_SIZE = 30

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

const TARGET_TYPE_LABELS: Record<string, string> = {
  profile: 'Profile',
  letter: 'Letter',
  dispatch: 'Dispatch',
  photo_moment: 'Photo',
  question_answer: 'Answer',
}

const TARGET_TYPES: ReportTargetType[] = ['profile', 'letter', 'dispatch', 'photo_moment', 'question_answer']

function buildHref(params: { status?: string; type?: string; page?: number }) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)
  if (params.page) query.set('page', String(params.page))
  const qs = query.toString()
  return qs ? `/admin/moderation/reports?${qs}` : '/admin/moderation/reports'
}

/**
 * Admin report queue — newest first, everything the checkpoint's own
 * "Minimum admin-side build" asks for and nothing else: no analytics,
 * no assignment, no case-management workflow. Clicking a row opens its
 * detail (app/admin/moderation/reports/[id]/page.tsx).
 *
 * Admin Operations Refinement checkpoint — this previously fetched an
 * unfiltered, hard `limit 50` with no pagination and no way to ever
 * reach a report past the 50th. Now server-paginated (30/page) with
 * status/target-type filters, matching the same pill-filter +
 * Previous/Next convention already established by
 * app/admin/moderation/public-content/page.tsx.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>
}) {
  const { status, type, page: pageParam } = await searchParams
  const reportStatus = status === 'open' || status === 'reviewed' ? status : undefined
  const targetType = TARGET_TYPES.includes(type as ReportTargetType) ? (type as ReportTargetType) : undefined
  const page = Math.max(0, Number(pageParam) || 0)

  const supabase = await createClient()
  const { data: reports, error } = await listReports(supabase, {
    status: reportStatus,
    targetType,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <div className="space-y-6">
      <h1 className={sectionTitleClass}>Report queue</h1>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { label: 'All statuses', value: undefined },
              { label: 'Open', value: 'open' as const },
              { label: 'Reviewed', value: 'reviewed' as const },
            ] as const
          ).map((opt) => (
            <Link key={opt.label} href={buildHref({ status: opt.value, type })} className={pillClass(reportStatus === opt.value)}>
              {opt.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status, type: undefined })} className={pillClass(targetType === undefined)}>
            All types
          </Link>
          {TARGET_TYPES.map((t) => (
            <Link key={t} href={buildHref({ status, type: t })} className={pillClass(targetType === t)}>
              {TARGET_TYPE_LABELS[t]}
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {reports.length === 0 ? (
        <p className={helperTextClass}>No reports match these filters.</p>
      ) : (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/admin/moderation/reports/${r.id}`}
              className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-foreground/[.03] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium text-foreground">
                  {TARGET_TYPE_LABELS[r.targetType] ?? r.targetType} · {REASON_LABELS[r.reason as ReportReason] ?? r.reason}
                </p>
                <p className={metadataTextClass}>
                  {r.reportedPseudonym} reported by {r.reporterPseudonym}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {r.status === 'open' && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[14px] font-medium text-accent">
                    Open
                  </span>
                )}
                <span className={`whitespace-nowrap ${metadataTextClass}`}>{formatDateTimeFull(r.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {page > 0 && (
          <Link href={buildHref({ status, type, page: page - 1 })} className={helperTextClass}>
            ← Previous
          </Link>
        )}
        {reports.length === PAGE_SIZE && (
          <Link href={buildHref({ status, type, page: page + 1 })} className={helperTextClass}>
            Next →
          </Link>
        )}
      </div>
    </div>
  )
}

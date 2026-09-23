import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listSafetyCases, type CaseStatusFilter } from '@/lib/admin-safety'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, helperTextClass, metadataTextClass, pillClass } from '@/app/profile/ui'
import { reasonCodeLabel, caseStatusLabel, riskBandLabel } from './reason-labels'

const PAGE_SIZE = 30

const STATUS_FILTERS: { label: string; value: CaseStatusFilter | undefined }[] = [
  { label: 'Active', value: 'active' },
  { label: 'Open', value: 'open' },
  { label: 'Reviewing', value: 'reviewing' },
  { label: 'No action', value: 'no_action' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'All', value: 'all' },
]

function buildHref(params: { status?: string; page?: number }) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.page) query.set('page', String(params.page))
  const qs = query.toString()
  return qs ? `/admin/moderation/needs-attention?${qs}` : '/admin/moderation/needs-attention'
}

/**
 * Safety 2, Checkpoint 7 — the Needs Attention case queue, built from
 * the EXISTING safety_cases table (Checkpoints 2-6), reusing the same
 * server-paginated, pill-filtered list pattern already established by
 * app/admin/moderation/reports/page.tsx. This is an operational triage
 * list, not a dossier: pseudonym, status, highest risk band, signal
 * count, and a compact aggregated reason summary — never an opaque
 * fraud score, never "scammer"/"guilty" language. Default view is
 * "Active" (open + reviewing), ordered so the most useful cases surface
 * first (admin_list_safety_cases' own ordering).
 */
export default async function NeedsAttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const { status, page: pageParam } = await searchParams
  const statusFilter = STATUS_FILTERS.find((f) => f.value === status)?.value ?? 'active'
  const page = Math.max(0, Number(pageParam) || 0)

  const supabase = await createClient()
  const { data: cases, error } = await listSafetyCases(supabase, {
    status: statusFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Needs Attention</h1>
        <p className={helperTextClass}>
          Structured Safety observations awaiting human review. These are signals for a person to look at — not a verdict.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link key={f.label} href={buildHref({ status: f.value === 'active' ? undefined : f.value })} className={pillClass(statusFilter === f.value)}>
            {f.label}
          </Link>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {cases.length === 0 ? (
        <p className={helperTextClass}>No cases match this filter.</p>
      ) : (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {cases.map((c) => (
            <Link
              key={c.id}
              href={`/admin/moderation/needs-attention/${c.id}`}
              className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-foreground/[.03] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium text-foreground">
                  {c.subjectPseudonym} · {riskBandLabel(c.highestRiskBand)} · {c.signalCount} signal{c.signalCount === 1 ? '' : 's'}
                </p>
                <p className={`truncate ${metadataTextClass}`}>
                  {c.reasonCodes.length > 0 ? c.reasonCodes.map(reasonCodeLabel).join(', ') : 'No structured reasons recorded'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[13px] font-medium text-foreground/80">
                  {caseStatusLabel(c.status)}
                </span>
                <span className={`whitespace-nowrap ${metadataTextClass}`}>{formatDateTimeFull(c.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {page > 0 && (
          <Link href={buildHref({ status, page: page - 1 })} className={helperTextClass}>
            ← Previous
          </Link>
        )}
        {cases.length === PAGE_SIZE && (
          <Link href={buildHref({ status, page: page + 1 })} className={helperTextClass}>
            Next →
          </Link>
        )}
      </div>
    </div>
  )
}

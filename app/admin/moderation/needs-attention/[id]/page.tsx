import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSafetyCase, listCaseSignals } from '@/lib/admin-safety'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, sectionLabelClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'
import CaseTransitionActions from '../case-transition-actions'
import CaseAccountInterventionActions from '../case-account-intervention-actions'
import SignalEvidence from '../signal-evidence'
import { reasonCodeLabel, caseStatusLabel, riskBandLabel, surfaceLabel } from '../reason-labels'

const INTERVENTION_STATUSES = new Set(['restricted', 'suspended', 'banned'])
const ACTIVE_CASE_STATUSES = new Set(['open', 'reviewing'])

/**
 * Safety 2, Checkpoint 7 — case detail. Shows this ONE case's own
 * safety_signals, ordered newest first, with structured evidence only
 * (surface, reason codes, risk band, time, warning states, behavioral
 * observed_counts, and an on-demand evidence link/preview) — never a
 * database JSON dump, never a raw fingerprint or dedup-implementation
 * detail (see admin_list_case_signals' own migration comment).
 *
 * Member context is deliberately narrow: pseudonym, current account
 * status, account age, and report/block counts — reused from EXISTING
 * Admin data sources (admin_get_safety_case), never a new profile
 * dossier. Account age and report/block counts are shown as CONTEXT for
 * the reviewer, never framed as evidence on their own.
 */
export default async function NeedsAttentionCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: safetyCase } = await getSafetyCase(supabase, id)

  if (!safetyCase) {
    notFound()
  }

  const { data: signals } = await listCaseSignals(supabase, id)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/moderation/needs-attention"
          className="text-[14px] text-foreground/70 transition-colors hover:text-foreground"
        >
          ← Needs Attention
        </Link>
      </div>

      <div className="space-y-1">
        <p className={sectionLabelClass}>{riskBandLabel(safetyCase.highestRiskBand)} · {safetyCase.signalCount} signal{safetyCase.signalCount === 1 ? '' : 's'}</p>
        <h1 className={sectionTitleClass}>Case for {safetyCase.subjectPseudonym}</h1>
        <p className={helperTextClass}>
          Opened {formatDateTimeFull(safetyCase.openedAt)} · Last updated {formatDateTimeFull(safetyCase.updatedAt)}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Member</p>
          <p className="text-[15px] text-foreground">{safetyCase.subjectPseudonym}</p>
          <p className={helperTextClass}>Current status: {safetyCase.subjectAccountStatus}</p>
          {safetyCase.subjectAccountCreatedAt && (
            <p className={helperTextClass}>Account created {formatDateTimeFull(safetyCase.subjectAccountCreatedAt)}</p>
          )}
          <Link
            href={`/admin/members/${safetyCase.subjectUserId}`}
            className="inline-block text-[14px] text-foreground/70 underline underline-offset-4 transition-colors hover:text-foreground"
          >
            View member
          </Link>
        </div>
        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Context</p>
          <p className={helperTextClass}>{safetyCase.subjectReportCount} report{safetyCase.subjectReportCount === 1 ? '' : 's'} against this member</p>
          <p className={helperTextClass}>{safetyCase.subjectBlockCount} block{safetyCase.subjectBlockCount === 1 ? '' : 's'} against this member</p>
          <p className={helperTextClass}>
            Account age and activity counts are context, not evidence on their own.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-foreground/[.06] px-2.5 py-1 text-[13px] font-medium text-foreground/80">
            {caseStatusLabel(safetyCase.status)}
          </span>
          {safetyCase.reviewedAt && (
            <span className={metadataTextClass}>
              Reviewed {formatDateTimeFull(safetyCase.reviewedAt)}
              {safetyCase.reviewedByPseudonym ? ` by ${safetyCase.reviewedByPseudonym}` : ''}
            </span>
          )}
        </div>
        <CaseTransitionActions caseId={safetyCase.id} status={safetyCase.status} />
      </div>

      <div className="space-y-2">
        <p className={sectionLabelClass}>Account action</p>
        {ACTIVE_CASE_STATUSES.has(safetyCase.status) ? (
          <CaseAccountInterventionActions
            caseId={safetyCase.id}
            caseStatus={safetyCase.status}
            accountStatus={safetyCase.subjectAccountStatus}
          />
        ) : INTERVENTION_STATUSES.has(safetyCase.status) ? (
          <p className={helperTextClass}>
            This case resulted in: {caseStatusLabel(safetyCase.status)}
            {safetyCase.reviewedByPseudonym ? ` (by ${safetyCase.reviewedByPseudonym})` : ''}
          </p>
        ) : (
          <p className={helperTextClass}>No account action was taken on this case.</p>
        )}
      </div>

      <div className="space-y-3">
        <p className={sectionLabelClass}>Signals</p>
        {signals.length === 0 ? (
          <p className={helperTextClass}>No signals recorded.</p>
        ) : (
          <div className="space-y-3">
            {signals.map((s) => (
              <div key={s.id} className="space-y-2 rounded-md border border-foreground/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[15px] font-medium text-foreground">{surfaceLabel(s.surface)}</p>
                  <p className={metadataTextClass}>{formatDateTimeFull(s.createdAt)}</p>
                </div>

                <p className={helperTextClass}>
                  {riskBandLabel(s.riskBand)}
                  {s.reasonCodes.length > 0 && ` · ${s.reasonCodes.map(reasonCodeLabel).join(', ')}`}
                </p>

                {(s.warningRequired || s.proceededAt) && (
                  <p className={helperTextClass}>
                    {s.warningRequired && (s.warningAcknowledgedAt ? 'Warning shown and acknowledged' : 'Warning shown, not yet acknowledged')}
                    {s.warningRequired && s.proceededAt ? ' · ' : ''}
                    {s.proceededAt && `Sent ${formatDateTimeFull(s.proceededAt)}`}
                  </p>
                )}

                {s.observedCounts && (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-foreground/70">
                    {Object.entries(s.observedCounts).map(([key, value]) => (
                      <div key={key}>
                        <span className="text-foreground/50">{key.replace(/_/g, ' ')}: </span>
                        <span>{String(value)}</span>
                      </div>
                    ))}
                  </dl>
                )}

                <SignalEvidence caseId={safetyCase.id} signalId={s.id} hasSourceContent={Boolean(s.sourceContentId)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

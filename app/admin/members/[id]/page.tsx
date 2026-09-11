import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMember, listMemberReports, listAuditForMember } from '@/lib/admin'
import { REPORT_REASONS } from '@/lib/reports'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, sectionLabelClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'
import AccountStatusActions from '@/app/admin/account-status-actions'

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: member }, { data: reports }, { data: audit }] = await Promise.all([
    getMember(supabase, id),
    listMemberReports(supabase, id),
    listAuditForMember(supabase, id),
  ])

  if (!member) {
    notFound()
  }

  const reportsAsTarget = reports.filter((r) => r.role === 'as_target')
  const reportsAsReporter = reports.filter((r) => r.role === 'as_reporter')

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="text-[15px] text-foreground/70 transition-colors hover:text-foreground">
          ← Member search
        </Link>
      </div>

      <div className="space-y-1">
        <h1 className={sectionTitleClass}>{member.pseudonym}</h1>
        {member.country && <p className={metadataTextClass}>{member.country}</p>}
        {member.statusReason && (
          <p className={helperTextClass}>
            Last status change: {member.statusReason}
            {member.statusChangedAt && ` — ${formatDateTimeFull(member.statusChangedAt)}`}
          </p>
        )}
      </div>

      <AccountStatusActions userId={member.id} currentStatus={member.status} />

      <div className="space-y-2">
        <p className={sectionLabelClass}>Reports where this member is the target</p>
        {reportsAsTarget.length === 0 ? (
          <p className={helperTextClass}>None.</p>
        ) : (
          <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
            {reportsAsTarget.map((r) => (
              <Link
                key={r.id}
                href={`/admin/moderation/reports/${r.id}`}
                className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-foreground/[.03]"
              >
                <p className="text-[15px] text-foreground">
                  {REASON_LABELS[r.reason] ?? r.reason} — reported by {r.otherPseudonym}
                </p>
                <p className={metadataTextClass}>{formatDateTimeFull(r.createdAt)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className={sectionLabelClass}>Reports submitted by this member</p>
        {reportsAsReporter.length === 0 ? (
          <p className={helperTextClass}>None.</p>
        ) : (
          <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
            {reportsAsReporter.map((r) => (
              <Link
                key={r.id}
                href={`/admin/moderation/reports/${r.id}`}
                className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-foreground/[.03]"
              >
                <p className="text-[15px] text-foreground">
                  {REASON_LABELS[r.reason] ?? r.reason} — about {r.otherPseudonym}
                </p>
                <p className={metadataTextClass}>{formatDateTimeFull(r.createdAt)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className={sectionLabelClass}>Admin history</p>
        {audit.length === 0 ? (
          <p className={helperTextClass}>None.</p>
        ) : (
          <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
            {audit.map((a) => (
              <div key={a.id} className="px-4 py-2.5">
                <p className="text-[15px] text-foreground">
                  {a.actorIdentifierSnapshot} — {a.action.replace('_', ' ')}
                </p>
                {a.reason && <p className={metadataTextClass}>{a.reason}</p>}
                <p className={metadataTextClass}>{formatDateTimeFull(a.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

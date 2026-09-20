import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMember, listMemberReports, listAuditForMember } from '@/lib/admin'
import { REPORT_REASONS } from '@/lib/reports'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, sectionLabelClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'
import AccountStatusActions from '@/app/admin/account-status-actions'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { getActiveCorrespondencePartnerIds, getLetterArchiveWithUser, isRichBody } from '@/lib/letters'
import FormattedText from '@/app/letters/formatted-text'
import AdminContactMember from './admin-contact-member'

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user: staffUser } } = await supabase.auth.getUser()

  const [{ data: member }, { data: reports }, { data: audit }, letters, activePartnerIds] = await Promise.all([
    getMember(supabase, id),
    listMemberReports(supabase, id),
    listAuditForMember(supabase, id),
    staffUser ? getLetterArchiveWithUser(supabase, staffUser.id, id) : Promise.resolve([]),
    staffUser ? getActiveCorrespondencePartnerIds(supabase, staffUser.id) : Promise.resolve(new Set<string>()),
  ])

  if (!member) {
    notFound()
  }

  const reportsAsTarget = reports.filter((r) => r.role === 'as_target')
  const reportsAsReporter = reports.filter((r) => r.role === 'as_reporter')
  const markUrl = member.markId ? publicProfileMarkUrl(supabase, `${member.markId}.png`) : null
  const hasActiveCorrespondence = activePartnerIds.has(member.id)
  const gender = member.gender === 'Self-describe' ? member.genderCustom : member.gender

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="text-[15px] text-foreground/70 transition-colors hover:text-foreground">
          ← Member search
        </Link>
      </div>

      <div className="flex items-start gap-5">
        <ProfileIdentityMark identifier={member.id} markUrl={markUrl} label={markUrl ? `${member.pseudonym}'s Mark` : undefined} size="lg" />
        <div className="min-w-0 space-y-1">
          <h1 className={sectionTitleClass}>{member.pseudonym}</h1>
          <p className={metadataTextClass}>{[member.country, member.region, member.ageRange, gender].filter(Boolean).join(' · ')}</p>
          {member.email && <p className={metadataTextClass}>{member.email}</p>}
          {member.createdAt && <p className={metadataTextClass}>Joined {formatDateTimeFull(member.createdAt)}</p>}
          {member.languages.length > 0 && <p className={metadataTextClass}>Languages: {member.languages.join(', ')}</p>}
          {member.intent.length > 0 && <p className={metadataTextClass}>Intent: {member.intent.join(', ')}</p>}
          {member.statusReason && (
            <p className={helperTextClass}>
              Last status change: {member.statusReason}
              {member.statusChangedAt && ` — ${formatDateTimeFull(member.statusChangedAt)}`}
            </p>
          )}
        </div>
      </div>

      <AccountStatusActions userId={member.id} currentStatus={member.status} />

      <div className="space-y-3">
        <p className={sectionLabelClass}>Correspondence with this member</p>
        {letters.length > 0 ? (
          <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
            {letters.map((letter) => (
              <Link key={letter.id} href={`/letters/${letter.id}`} className="block px-4 py-3 transition-colors hover:bg-foreground/[.03]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[14px] font-medium text-foreground">
                    {letter.senderId === member.id ? member.pseudonym : 'TEMPA staff'}
                  </p>
                  <p className={metadataTextClass}>{formatDateTimeFull(letter.createdAt)}</p>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/75">
                  <FormattedText text={letter.body} isRich={isRichBody(letter.body)} />
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className={helperTextClass}>No correspondence with this member.</p>
        )}
        {hasActiveCorrespondence ? (
          <Link href={`/letters/with/${member.id}`} className="text-[14px] font-medium text-foreground underline underline-offset-4">
            Open correspondence
          </Link>
        ) : (
          <AdminContactMember memberId={member.id} />
        )}
      </div>

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

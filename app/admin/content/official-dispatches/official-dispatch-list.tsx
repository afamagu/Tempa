import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getOfficialDispatches, isWithinDispatchEditWindow, type OfficialPublishedAs } from '@/lib/dispatches'
import { safeSponsorUrl } from '@/lib/dispatch-identity'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, primaryButtonClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CopyShareLinkButton from './copy-share-link-button'

const COPY: Record<OfficialPublishedAs, { title: string; blurb: string; newLabel: string; base: string; empty: string }> = {
  tempa: {
    title: 'Tempa Dispatches',
    blurb:
      'Full Dispatches published by Tempa — shown with the Tempa emblem and “Tempa”, never your own name or profile. Appear on The Board, the reader and shared links, and may appear on Home.',
    newLabel: 'New Tempa Dispatch',
    base: '/admin/content/dispatches',
    empty: 'No Tempa Dispatches yet.',
  },
  sponsored: {
    title: 'Sponsored',
    blurb:
      'Sponsored content in the Dispatch format — always labelled Sponsored with the sponsor’s name, never presented as Tempa or as a member. Appears on The Board only (never Home, never a profile).',
    newLabel: 'New Sponsored Dispatch',
    base: '/admin/content/sponsored',
    empty: 'No Sponsored Dispatches yet.',
  },
}

/**
 * Admin Content → Dispatches / Sponsored. Rows come from the admin's own
 * session (dispatches RLS) — no service role. Publishing/editing goes
 * through publish_official_dispatch / update_official_dispatch, which
 * re-check is_staff('admin') server-side regardless of this page.
 */
export default async function OfficialDispatchList({ kind }: { kind: OfficialPublishedAs }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const rows = await getOfficialDispatches(supabase, kind)
  const copy = COPY[kind]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl space-y-1">
          <h1 className={sectionTitleClass}>{copy.title}</h1>
          <p className={adminMetadataClass}>{copy.blurb}</p>
        </div>
        <Link href={`${copy.base}/new`} className={primaryButtonClass}>
          {copy.newLabel}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className={adminMetadataClass}>{copy.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const editable = row.authorId === user?.id && isWithinDispatchEditWindow(row.publishedAt)
            const ctaUrl = safeSponsorUrl(row.sponsorCtaUrl)
            return (
              <li key={row.id} className="space-y-2 rounded-md border border-foreground/10 bg-background p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px] font-medium text-foreground">{row.title}</p>
                  <p className={adminMetadataClass}>
                    {row.moderationStatus === 'hidden' ? 'Hidden by moderation · ' : 'Published · '}
                    {formatDateTimeFull(row.publishedAt)}
                  </p>
                </div>
                {kind === 'sponsored' && (
                  <p className={adminMetadataClass}>
                    Sponsor: {row.sponsorName}
                    {ctaUrl ? ` · ${row.sponsorCtaLabel ?? 'Learn more'} → ${ctaUrl}` : ' · no link'}
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                  <Link
                    href={`/board/${row.id}`}
                    className="text-[13px] font-medium text-foreground/80 underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
                  >
                    Open
                  </Link>
                  {editable && (
                    <Link
                      href={`${copy.base}/${row.id}/edit`}
                      className="text-[13px] font-medium text-foreground/80 underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
                    >
                      Edit
                    </Link>
                  )}
                  {row.moderationStatus === 'visible' && <CopyShareLinkButton dispatchId={row.id} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

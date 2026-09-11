import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listPublicContent, type ContentType, type ModerationStatus } from '@/lib/admin-moderation'
import { sectionTitleClass, helperTextClass, metadataTextClass, pillClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'
import ContentModerationActions from '@/app/admin/content-moderation-actions'
import ContentHistory from './content-history'

const PAGE_SIZE = 30

const TYPE_LABELS: Record<ContentType, string> = {
  dispatch: 'Dispatch',
  question_answer: 'Answer',
}

function buildHref(params: { type?: string; status?: string; page?: number }) {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.status) query.set('status', params.status)
  if (params.page) query.set('page', String(params.page))
  const qs = query.toString()
  return qs ? `/admin/moderation/public-content?${qs}` : '/admin/moderation/public-content'
}

/**
 * Admin Command Center Phase 2A-1 — proactive supervision of PUBLIC
 * member content (published Dispatches, live-to-Minds Question
 * answers). Admin-only (admin_list_public_content requires
 * is_staff('admin') server-side) — a moderator cannot reach this page's
 * data even by guessing the RPC call; their content access stays
 * strictly report-driven. Explicitly NOT a private-correspondence
 * browser: nothing here ever reads letters, moments, or
 * letter_postcards.
 */
export default async function PublicContentReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; page?: string }>
}) {
  const { type, status, page: pageParam } = await searchParams
  const contentType = type === 'dispatch' || type === 'question_answer' ? (type as ContentType) : undefined
  const moderationStatus = status === 'visible' || status === 'hidden' ? (status as ModerationStatus) : undefined
  const page = Math.max(0, Number(pageParam) || 0)

  const supabase = await createClient()
  const { data: items, error } = await listPublicContent(supabase, {
    type: contentType,
    status: moderationStatus,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <div className="space-y-6">
      <h1 className={sectionTitleClass}>Public Content</h1>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { label: 'All types', value: undefined },
              { label: 'Dispatches', value: 'dispatch' as const },
              { label: 'Answers', value: 'question_answer' as const },
            ] as const
          ).map((opt) => (
            <Link
              key={opt.label}
              href={buildHref({ type: opt.value, status })}
              className={pillClass(contentType === opt.value)}
            >
              {opt.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { label: 'All statuses', value: undefined },
              { label: 'Visible', value: 'visible' as const },
              { label: 'Hidden', value: 'hidden' as const },
            ] as const
          ).map((opt) => (
            <Link
              key={opt.label}
              href={buildHref({ type, status: opt.value })}
              className={pillClass(moderationStatus === opt.value)}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {items.length === 0 ? (
        <p className={helperTextClass}>No content matches these filters.</p>
      ) : (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {items.map((item) => (
            <div key={`${item.contentType}-${item.id}`} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={metadataTextClass}>
                    {TYPE_LABELS[item.contentType]} · by{' '}
                    <Link href={`/minds/${item.authorId}`} className="underline decoration-foreground/25 underline-offset-4 hover:text-foreground">
                      {item.authorPseudonym}
                    </Link>{' '}
                    · {formatDateTimeFull(item.contentCreatedAt)}
                  </p>
                  <p className="mt-0.5 truncate text-[15px] font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-foreground/70">{item.excerpt}</p>
                </div>
                <Link
                  href={item.contentType === 'dispatch' ? `/board/${item.id}` : `/minds/${item.authorId}`}
                  className="shrink-0 text-[14px] font-medium text-foreground/60 underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
                >
                  Open
                </Link>
              </div>

              <ContentModerationActions
                contentType={item.contentType}
                contentId={item.id}
                currentStatus={item.moderationStatus}
              />

              <ContentHistory contentType={item.contentType} contentId={item.id} />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {page > 0 && (
          <Link href={buildHref({ type, status, page: page - 1 })} className={helperTextClass}>
            ← Previous
          </Link>
        )}
        {items.length === PAGE_SIZE && (
          <Link href={buildHref({ type, status, page: page + 1 })} className={helperTextClass}>
            Next →
          </Link>
        )}
      </div>
    </div>
  )
}

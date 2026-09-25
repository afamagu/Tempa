import Link from 'next/link'
import DispatchIdentityLabel from '@/app/board/dispatch-identity-label'
import { formatDatePlain } from '@/lib/format-date'
import { metadataTextClass } from '@/app/profile/ui'
import type { BoardFeedItem } from '@/lib/dispatches'

/**
 * A real reading shelf rather than another Board-card grid: one quiet
 * index row per kept mind, with identity and title only. The absence of
 * excerpts and Moment thumbnails is the point — this is a compact path
 * back into writing by people the member deliberately kept.
 */
export default function KeptDispatchShelf({
  dispatches,
  trailQueryFor,
}: {
  dispatches: BoardFeedItem[]
  trailQueryFor: (dispatch: BoardFeedItem) => string
}) {
  return (
    <div className="overflow-hidden rounded-md border border-foreground/10">
      {dispatches.map((dispatch, index) => (
        <div
          key={dispatch.id}
          className={`grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center sm:gap-6 ${
            index > 0 ? 'border-t border-foreground/10' : ''
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <DispatchIdentityLabel identity={dispatch.identity} />
            <span className={`shrink-0 ${metadataTextClass}`}>· {formatDatePlain(dispatch.publishedAt)}</span>
          </div>
          <Link
            href={`/board/${dispatch.id}?${trailQueryFor(dispatch)}`}
            className="min-w-0 font-serif text-[16px] leading-snug text-foreground transition-opacity hover:opacity-70 sm:text-right"
          >
            {dispatch.title}
          </Link>
        </div>
      ))}
    </div>
  )
}

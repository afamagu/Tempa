import Link from 'next/link'
import { metadataTextClass } from '@/app/profile/ui'
import { formatDatePlain } from '@/lib/format-date'
import FormattedText from '@/app/letters/formatted-text'
import { dispatchExcerpt, dispatchIsRich, type DispatchListItem } from '@/lib/dispatches'
import DispatchAuthorLink from '@/app/board/dispatch-author-link'

/**
 * One Home Dispatch preview — a WIDE horizontal card spanning the
 * content column, one of up to 3 stacked top-to-bottom (Board usability
 * checkpoint, 2026-09-09; replaces the earlier narrow 2-per-row grid
 * tile, which read as cramped). Writing stays the hero: title and a
 * 2-3-line excerpt occupy the majority of the card; the optional Moment
 * thumbnail is small and fixed-size so it can never dominate. Plain
 * `<Link>`, no drag/swipe handlers, no carousel machinery of any kind —
 * see app/home/page.tsx for confirmation the cards are laid out as a
 * static vertical stack, never a horizontally-scrolling row.
 *
 * Structural fix (author-identity live-test regression): the entire
 * card used to be ONE Link to `/board/[id]`, which meant the author's
 * pseudonym had no way to separately link to `/minds/[authorId]` —
 * nesting a second anchor inside the card's own Link would be invalid
 * HTML. The identity row is now its OWN link (DispatchAuthorLink,
 * shared with app/board/dispatch-card.tsx), a sibling of a second Link
 * wrapping the title/excerpt/thumbnail — exactly the pattern
 * DispatchCard already used correctly. The outer container is a plain,
 * non-interactive bordered div; only the two inner Links navigate.
 */
export default function BoardShelfCard({
  dispatch,
  thumbnailUrl,
}: {
  dispatch: DispatchListItem
  thumbnailUrl?: string
}) {
  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="flex items-center gap-1.5">
        <DispatchAuthorLink
          authorId={dispatch.authorId}
          authorPseudonym={dispatch.authorPseudonym}
          authorCountry={dispatch.authorCountry}
        />
        <p className={`shrink-0 ${metadataTextClass}`}>· {formatDatePlain(dispatch.publishedAt)}</p>
      </div>

      <Link
        href={`/board/${dispatch.id}`}
        className="mt-2 flex items-start gap-4 transition-colors hover:opacity-80"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-medium text-foreground">{dispatch.title}</p>
          <div className="mt-1 rounded bg-surface-shell p-2">
            <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[14px] leading-snug text-foreground/70 sm:line-clamp-3">
              <FormattedText text={dispatchExcerpt(dispatch.body)} isRich={dispatchIsRich(dispatch.body)} />
            </p>
          </div>
        </div>
        {thumbnailUrl && <img src={thumbnailUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
      </Link>
    </div>
  )
}

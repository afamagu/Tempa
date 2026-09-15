import Link from 'next/link'
import { metadataTextClass } from '@/app/profile/ui'
import { formatDatePlain } from '@/lib/format-date'
import FormattedText from '@/app/letters/formatted-text'
import { dispatchExcerpt, dispatchIsRich, type DispatchListItem } from '@/lib/dispatches'
import DispatchAuthorLink from '@/app/board/dispatch-author-link'

/**
 * One Home Dispatch preview card — a WIDE horizontal card, used across
 * every section of Home's editorial Board reading surface (Featured,
 * Your Reading Shelf, From Minds You Keep, A Little Serendipity; see
 * app/home/page.tsx). Writing stays the hero: title and a clamped
 * excerpt occupy the majority of the card; the optional Moment
 * thumbnail is small and fixed-size so it can never dominate. Plain
 * `<Link>`, no drag/swipe handlers, no carousel machinery of its own —
 * any horizontal scrolling (the mobile Reading Shelf) is the CALLER's
 * own overflow/scroll-snap wrapper, not something this component knows
 * about (see `size="shelf"` below for the one visual accommodation it
 * makes for that context).
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
/**
 * Home Phase 1 (Editorial Reading Surface) — restrained size variants
 * of the SAME card, never separate components: 'lead' (Featured's one
 * visually stronger card — larger title, a taller excerpt, a bigger
 * thumbnail), 'default' (Featured's supporting cards, From Minds You
 * Keep, A Little Serendipity), 'shelf' (Your Reading Shelf's more
 * compact, fixed-width card for the mobile horizontal scroll-snap row),
 * and 'continue' (Home Phase 1C — the Dispatch detail page's Continue
 * Reading shelf: a 2-per-row desktop card with real breathing room, so
 * it reads as a deliberate "what to read next" moment rather than a
 * compressed rail — see its own EXCERPT_WRAPPER_CLASS entry below for
 * why its excerpt drops the bg-surface-shell inset entirely). Only type
 * scale/clamp/thumbnail size (and, for 'continue', the excerpt's own
 * surface treatment) change between variants — never a different
 * layout grammar, so the whole editorial surface still reads as one
 * consistent card language.
 */
export type BoardShelfCardSize = 'lead' | 'default' | 'shelf' | 'continue'

const TITLE_CLASS: Record<BoardShelfCardSize, string> = {
  lead: 'text-[19px] sm:text-[22px] font-medium text-foreground',
  default: 'truncate text-[16px] font-medium text-foreground',
  shelf: 'truncate text-[15px] font-medium text-foreground',
  continue: 'line-clamp-2 text-[17px] font-medium text-foreground',
}

const EXCERPT_CLAMP_CLASS: Record<BoardShelfCardSize, string> = {
  lead: 'line-clamp-3 sm:line-clamp-4',
  default: 'line-clamp-2 sm:line-clamp-3',
  shelf: 'line-clamp-2',
  continue: 'line-clamp-2',
}

// Home Phase 1C — every size but 'continue' keeps the excerpt inset in
// the shared bg-surface-shell "authored paper" surface (see the
// board-shelf-card.test.tsx assertion that locks this in for the
// default size). 'continue' drops that inset: at this card's larger
// scale the beige box read as a small form/input control rather than
// editorial preview copy, so its excerpt sits directly on the card,
// same serif/leading treatment, just no background or padding.
const EXCERPT_WRAPPER_CLASS: Record<BoardShelfCardSize, string> = {
  lead: 'mt-1 rounded bg-surface-shell p-2',
  default: 'mt-1 rounded bg-surface-shell p-2',
  shelf: 'mt-1 rounded bg-surface-shell p-2',
  continue: 'mt-1.5',
}

const THUMBNAIL_SIZE_CLASS: Record<BoardShelfCardSize, string> = {
  lead: 'h-20 w-20 sm:h-24 sm:w-24',
  default: 'h-14 w-14',
  shelf: 'h-12 w-12',
  continue: 'h-16 w-16 sm:h-24 sm:w-24',
}

export default function BoardShelfCard({
  dispatch,
  thumbnailUrl,
  trailQuery,
  size = 'default',
}: {
  dispatch: DispatchListItem
  thumbnailUrl?: string
  /** Home Phase 1 (Reading Trail) — see dispatch-card.tsx's matching
   * prop; identical purpose, identical query-string shape. */
  trailQuery?: string
  size?: BoardShelfCardSize
}) {
  const href = trailQuery ? `/board/${dispatch.id}?${trailQuery}` : `/board/${dispatch.id}`
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

      <Link href={href} className="mt-2 flex items-start gap-4 transition-colors hover:opacity-80">
        <div className="min-w-0 flex-1">
          <p className={TITLE_CLASS[size]}>{dispatch.title}</p>
          <div className={EXCERPT_WRAPPER_CLASS[size]}>
            <p
              className={`whitespace-pre-wrap font-serif text-[14px] leading-snug text-foreground/70 ${EXCERPT_CLAMP_CLASS[size]}`}
            >
              <FormattedText text={dispatchExcerpt(dispatch.body)} isRich={dispatchIsRich(dispatch.body)} />
            </p>
          </div>
        </div>
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt="" className={`shrink-0 rounded object-cover ${THUMBNAIL_SIZE_CLASS[size]}`} />
        )}
      </Link>
    </div>
  )
}

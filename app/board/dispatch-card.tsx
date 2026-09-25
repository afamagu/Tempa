import Link from 'next/link'
import { metadataTextClass } from '@/app/profile/ui'
import { formatDatePlain } from '@/lib/format-date'
import FormattedText from '@/app/letters/formatted-text'
import { dispatchExcerpt, dispatchIsRich, type DispatchListItem } from '@/lib/dispatches'
import DispatchIdentityLabel from './dispatch-identity-label'
import TopicChips from './topic-chips'

/**
 * One Dispatch in a Board/profile list — an editorial, writing-desk
 * feel, never a social-media feed row (Board usability visual
 * follow-up, 2026-09-09): each Dispatch is its OWN restrained bordered/
 * rounded card, not a flush row separated only by a hairline divider —
 * a member scanning the list should read each one unmistakably as a
 * distinct piece of writing. Separation comes from spacing + a subtle
 * border + restrained corners, never a heavy shadow, gradient, or
 * gloss. Callers stack these with plain vertical spacing (`space-y-4`
 * or similar) — never `divide-y`, which would visually compete with
 * each card's own border.
 *
 * The excerpt itself sits on the same `bg-surface-shell` authored-
 * paper surface used everywhere else a member's actual writing is
 * shown (see the Build Guide's "authored-writing surface" rule) —
 * identity, date, title, and topics stay on the ordinary card
 * background.
 *
 * Layout locked by the Board live-test corrections (2026-09-10):
 * `keepSlot` (see keep-button.tsx) sits ONLY in the identity row, as a
 * sibling of the pseudonym/flag/date group, never nested inside the
 * same flex row as the title/excerpt/thumbnail — a live-test report
 * found the previous layout let Keep's own width influence how much
 * room the excerpt column got. The identity row is now plain
 * (non-link) content; the title/excerpt/thumbnail block below is its
 * own full-width Link to the reader, so the vast majority of the
 * card's area still navigates.
 */
export default function DispatchCard({
  dispatch,
  keepSlot,
  trailQuery,
}: {
  dispatch: DispatchListItem
  keepSlot?: React.ReactNode
  /** Home Phase 1 (Reading Trail) — the reading-trail query string
   * (readingTrailSearchParams(...).toString(), lib/dispatches.ts) for
   * THIS card's own position in an already-ranked board_feed_page
   * result, appended to its link so the Dispatch detail page can offer
   * Continue Reading. Omitted entirely for search results (which carry
   * no tiering/cursor of any kind) — no trail is ever manufactured for
   * those. */
  trailQuery?: string
}) {
  const href = trailQuery ? `/board/${dispatch.id}?${trailQuery}` : `/board/${dispatch.id}`
  return (
    <div className="rounded-md border border-foreground/10 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* member -> profile link (unchanged); Tempa -> emblem + "Tempa";
              Sponsored -> "Sponsored" + sponsor (lib/dispatch-identity.ts) */}
          <DispatchIdentityLabel identity={dispatch.identity} />
          <p className={`shrink-0 ${metadataTextClass}`}>· {formatDatePlain(dispatch.publishedAt)}</p>
        </div>
        {keepSlot && <div className="shrink-0">{keepSlot}</div>}
      </div>

      <Link href={href} className="mt-2 block transition-colors hover:opacity-80">
        <div>
          <div className="min-w-0">
            <p className="text-[16px] font-medium text-foreground">{dispatch.title}</p>
            <div className="mt-2 rounded-md bg-surface-shell p-3 sm:p-4">
              <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-foreground/80">
                <FormattedText text={dispatchExcerpt(dispatch.body)} isRich={dispatchIsRich(dispatch.body)} />
              </p>
            </div>
          </div>
        </div>
        {dispatch.topics.length > 0 && (
          <div className="mt-2">
            <TopicChips topics={dispatch.topics} />
          </div>
        )}
        {/* Deliberately nothing else here — no like/reaction/comment
            affordance, no view count. See the Build Guide's Dispatches
            section for why. */}
      </Link>
    </div>
  )
}

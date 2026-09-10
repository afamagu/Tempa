import Link from 'next/link'
import Mindform from '@/app/mindform'
import MailInTransitIcon from '@/app/mail-in-transit-icon'
import SystemMessage from '@/app/system-message'
import FormattedText from '@/app/letters/formatted-text'
import { helperTextClass, metadataTextClass } from '@/app/profile/ui'
import { formatDateTimeCompact } from '@/lib/format-date'
import { letterPreviewText, isRichBody, type LetterboxFilter, type LetterboxPerson } from '@/lib/letters'

/**
 * A small, restrained unread-count badge — same visual language as
 * the nav shell's own Badge (app-shell.tsx): quiet accent color, never
 * red/alarming, capped display at "99+". Only rendered when this
 * person has at least one unread incoming letter across their visible
 * correspondence(s) (see getLetterboxPeople's unreadCount aggregation).
 * Deliberately the stronger of the two badges on a card — unread means
 * something has actually arrived and hasn't been opened yet, distinct
 * from MailInTransitBadge below, which only means something is still
 * travelling.
 */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} unread letter${count === 1 ? '' : 's'}`}
      className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function emptyStateCopy(filter: LetterboxFilter, hasAnyPeopleAtAll: boolean): string {
  if (!hasAnyPeopleAtAll) return "You don't have any letters yet."
  if (filter === 'new') return 'Nothing new right now.'
  if (filter === 'sent') return "You haven't sent a letter yet."
  return "You don't have any letters yet."
}

/**
 * Letterbox Level 1's entire visible surface: a restrained, near-
 * square grid of people, address-book style — not a social feed.
 * Avatar, pseudonym, a compact excerpt of the most recent VISIBLE
 * letter, its viewer-local date/time, and — only when genuinely
 * nonzero — an unread badge and/or an explicit "Mail on the way"
 * system-voice line (SystemMessage, app/system-message.tsx, quiet
 * variant) — kept visually distinct from the excerpt above it rather
 * than a tiny icon-only badge, per the system-voice/Mail-on-the-way
 * presentation checkpoint. A card is a preview/navigation surface, never a
 * excerpt is the letter's first paragraph (letterPreviewText,
 * lib/letters.ts), CSS-clamped to two lines on top of that — long and
 * short letters must produce approximately the same card height.
 * Ordering is whatever order `people` already arrives in
 * (getLetterboxPeople sorts newest-activity first) — grid flow alone
 * puts the newest person upper-left.
 */
export default function PeopleGrid({
  people,
  hasAnyPeopleAtAll,
  filter,
  mailInTransitPersonIds,
}: {
  /** Already filtered (see filterLetterboxPeople, lib/letters.ts) —
   * this component only renders, it never decides what belongs in
   * All/New/Sent. */
  people: LetterboxPerson[]
  /** Whether the viewer's Letterbox has ANY visible correspondent at
   * all, before this filter was applied — distinguishes "nothing here
   * yet" from "nothing matches this filter" in the empty state. */
  hasAnyPeopleAtAll: boolean
  filter: LetterboxFilter
  /** Correspondent ids currently sending mail this viewer's way but
   * hasn't received yet — sourced from incoming_mail_in_transit
   * (lib/letters.ts), never from anything letters_for_participant
   * already hides. */
  mailInTransitPersonIds: Set<string>
}) {
  if (people.length === 0) {
    return <p className={helperTextClass}>{emptyStateCopy(filter, hasAnyPeopleAtAll)}</p>
  }

  // Desktop layout preference (pre-beta UX polish batch 1) — a single
  // stacked horizontal correspondence row, replacing the previous
  // sm:grid-cols-2 lg:grid-cols-3 narrow-card grid. Each card is
  // already an internally horizontal row (avatar + text); this just
  // stops them from being squeezed three-across on a wide screen.
  // Mobile is unaffected — it was already grid-cols-1.
  return (
    <div className="grid grid-cols-1 gap-3">
      {people.map((person) => (
        <Link
          key={person.userId}
          href={`/letters/with/${person.userId}`}
          className="relative flex items-center gap-3 rounded-md border border-foreground/10 p-3 transition-colors hover:border-foreground/25 hover:bg-foreground/[.02]"
        >
          <UnreadBadge count={person.unreadCount} />
          <Mindform identifier={person.userId} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[14px] font-medium text-foreground">{person.pseudonym}</p>
              <span className={`shrink-0 ${metadataTextClass}`}>
                {formatDateTimeCompact(new Date(person.activityAt).toISOString())}
              </span>
            </div>
            {person.latestExcerpt && (
              <div className="mt-0.5 rounded bg-surface-shell p-2">
                <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[13px] leading-snug text-foreground/70">
                  <FormattedText
                    text={letterPreviewText(person.latestExcerpt)}
                    isRich={isRichBody(person.latestExcerpt)}
                  />
                </p>
              </div>
            )}
            {mailInTransitPersonIds.has(person.userId) && (
              <SystemMessage
                variant="quiet"
                icon={<MailInTransitIcon className="h-3 w-3 text-foreground/50" />}
                title="Mail on the way"
                className="mt-1"
              />
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}

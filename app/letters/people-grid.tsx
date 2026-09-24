import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import { helperTextClass, metadataTextClass } from '@/app/profile/ui'
import { formatDateShort } from '@/lib/format-date'
import {
  letterPreviewText,
  isRichBody,
  deriveLetterboxCardStatus,
  type LetterboxPerson,
} from '@/lib/letters'

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
      className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Release Polish Pass — the one quiet status line deriveLetterboxCardStatus
 * produces (New letter / Waiting for a reply / Last exchanged {date}).
 * "Mail on the way" is rendered separately, unconditionally, alongside
 * this — see deriveLetterboxCardStatus's own doc comment for why the
 * two are independent rather than one mutually-exclusive state. */
function CardStatusLine({ person }: { person: LetterboxPerson }) {
  const status = deriveLetterboxCardStatus(person)
  if (status.kind === 'new') {
    return <p className="text-[13px] font-medium text-accent">New letter</p>
  }
  if (status.kind === 'waiting_for_reply') {
    return <p className={metadataTextClass}>Waiting for a reply</p>
  }
  return <p className={metadataTextClass}>Last exchanged {formatDateShort(new Date(status.activityAt).toISOString())}</p>
}

/**
 * Letterbox Level 1's entire visible surface: a responsive
 * correspondence-CARD grid, address-book style — the PERSON is the
 * primary object, never an individual message row. 3 cards per row on
 * a large desktop, 2 on tablet, 1 on phone (Release Polish Pass —
 * restores this grid after a prior pass had collapsed it into a
 * single-column stack of horizontal rows, which read too much like a
 * generic email inbox).
 *
 * Each card leads with the pseudonym at real visual weight, quiet
 * country/age-range metadata beneath it, ONE subordinate serif excerpt
 * line from the most recent VISIBLE letter (letterPreviewText,
 * lib/letters.ts — first paragraph only, CSS-clamped to two lines on
 * top of that so long and short letters produce approximately the same
 * card height), and a single quiet status line
 * (deriveLetterboxCardStatus) — deliberately plain text, not another
 * filled bg-surface-shell strip, so the excerpt reads as a quiet
 * aside rather than a Gmail-style preview strip. The corner unread
 * badge is unchanged from before; the independent "Mail on the way"
 * block (Brand asset pass, app/mail-on-the-way.tsx) now uses the
 * approved travelling-envelope asset and pale postal-notice treatment
 * instead of the old plain stroke icon + inline SystemMessage line.
 * Ordering is whatever order `people` already arrives in
 * (getLetterboxPeople sorts newest-activity first) — grid flow alone
 * puts the newest person first.
 */
export default function PeopleGrid({
  people,
  mailInTransitPersonIds,
}: {
  people: LetterboxPerson[]
  /** Correspondent ids currently sending mail this viewer's way but
   * hasn't received yet — sourced from incoming_mail_in_transit
   * (lib/letters.ts), never from anything letters_for_participant
   * already hides. */
  mailInTransitPersonIds: Set<string>
}) {
  if (people.length === 0) {
    return <p className={helperTextClass}>You don&apos;t have any letters yet.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {people.map((person) => (
        <Link
          key={person.userId}
          href={`/letters/with/${person.userId}`}
          className="relative flex flex-col gap-2.5 rounded-md border border-foreground/10 p-4 transition-colors hover:border-foreground/25 hover:bg-foreground/[.02]"
        >
          <UnreadBadge count={person.unreadCount} />

          <div className="flex items-center gap-3">
            <ProfileIdentityMark
              identifier={person.userId}
              markUrl={person.markUrl ?? null}
              label={person.markUrl ? `${person.pseudonym}'s Mark` : undefined}
              size="lg"
            />
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold text-foreground">{person.pseudonym}</p>
              <p className={`truncate ${metadataTextClass}`}>
                {[person.country, person.ageRange].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {person.latestExcerpt && (
            <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[14px] italic leading-snug text-foreground/60">
              <FormattedText text={letterPreviewText(person.latestExcerpt)} isRich={isRichBody(person.latestExcerpt)} />
            </p>
          )}

          <div className="mt-auto space-y-1 pt-1">
            <CardStatusLine person={person} />
            {mailInTransitPersonIds.has(person.userId) && <MailOnTheWay />}
          </div>
        </Link>
      ))}
    </div>
  )
}

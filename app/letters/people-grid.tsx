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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} unread letter${count === 1 ? '' : 's'}`}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * Phase 4 — relationship-first Letterbox status language. The line describes
 * the state of the relationship, not the age of an inbox item. Rhythm-aware
 * wording is added only when the canonical Phase 3 rhythm state is actually
 * available; this component never guesses someone's cadence from elapsed
 * time alone.
 */
function CorrespondenceStatusLine({ person }: { person: LetterboxPerson }) {
  const status = deriveLetterboxCardStatus(person)
  if (status.kind === 'new') {
    return <p className="text-[13px] font-medium text-accent">Letter waiting</p>
  }
  if (status.kind === 'waiting_for_reply') {
    return <p className={metadataTextClass}>Quiet right now</p>
  }
  return (
    <p className={metadataTextClass}>
      Last exchanged {formatDateShort(new Date(status.activityAt).toISOString())}
    </p>
  )
}

/**
 * Phase 4 — Letterbox is a short list of living ties, not an address-book
 * gallery and not an email inbox. One restrained row per person keeps the
 * human identity primary while giving relationship state, latest context and
 * mail-in-transit enough room to be understood at a glance.
 */
export default function PeopleGrid({
  people,
  mailInTransitPersonIds,
}: {
  people: LetterboxPerson[]
  mailInTransitPersonIds: Set<string>
}) {
  if (people.length === 0) {
    return (
      <div className="rounded-md border border-foreground/10 px-5 py-6">
        <p className="font-serif text-[17px] text-foreground">No correspondence yet.</p>
        <p className={`mt-1 ${helperTextClass}`}>
          When a first letter becomes a real exchange, that person will live here.
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-foreground/10 border-y border-foreground/10">
      {people.map((person) => (
        <Link
          key={person.userId}
          href={`/letters/with/${person.userId}`}
          className="group grid gap-3 px-1 py-5 transition-colors hover:bg-foreground/[.02] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <ProfileIdentityMark
              identifier={person.userId}
              markUrl={person.markUrl ?? null}
              label={person.markUrl ? `${person.pseudonym}'s Mark` : undefined}
              size="lg"
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[17px] font-semibold text-foreground group-hover:text-foreground/85">
                  {person.pseudonym}
                </p>
                <UnreadBadge count={person.unreadCount} />
              </div>
              <p className={`truncate ${metadataTextClass}`}>
                {[person.country, person.ageRange].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="min-w-0 sm:px-2">
            {person.latestExcerpt ? (
              <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[14px] italic leading-snug text-foreground/60">
                <FormattedText
                  text={letterPreviewText(person.latestExcerpt)}
                  isRich={isRichBody(person.latestExcerpt)}
                />
              </p>
            ) : (
              <p className={helperTextClass}>Your correspondence is here.</p>
            )}
          </div>

          <div className="flex min-w-[9rem] items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-center sm:text-right">
            <CorrespondenceStatusLine person={person} />
            {mailInTransitPersonIds.has(person.userId) && <MailOnTheWay />}
          </div>
        </Link>
      ))}
    </div>
  )
}

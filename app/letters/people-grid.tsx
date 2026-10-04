import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import { helperTextClass, metadataTextClass, sectionLabelClass } from '@/app/profile/ui'
import { letterPreviewText, isRichBody } from '@/lib/letters'
import type { RelationshipSurfacePerson } from '@/lib/relationship-surface'

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

function RelationshipRow({
  person,
  mailOnTheWay,
}: {
  person: RelationshipSurfacePerson
  mailOnTheWay: boolean
}) {
  return (
    <Link
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

      <div className="flex min-w-[10rem] items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-center sm:text-right">
        <p
          className={
            person.unreadCount > 0
              ? 'text-[13px] font-medium text-accent'
              : metadataTextClass
          }
        >
          {person.statusText}
        </p>
        {mailOnTheWay && <MailOnTheWay />}
      </div>
    </Link>
  )
}

function RelationshipSection({
  label,
  people,
  mailInTransitPersonIds,
}: {
  label: string
  people: RelationshipSurfacePerson[]
  mailInTransitPersonIds: Set<string>
}) {
  if (people.length === 0) return null

  return (
    <section className="space-y-2" aria-label={label}>
      <p className={sectionLabelClass}>{label}</p>
      <div className="divide-y divide-foreground/10 border-y border-foreground/10">
        {people.map((person) => (
          <RelationshipRow
            key={person.userId}
            person={person}
            mailOnTheWay={mailInTransitPersonIds.has(person.userId)}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Phase 4 — Letterbox is a small relationship surface, not an address-book
 * gallery and not an email inbox. Living established correspondence is first;
 * first-contact attempts remain visibly distinct; history is deliberately
 * secondary. Pause/resume is not represented until its later product phase.
 */
export default function PeopleGrid({
  people,
  mailInTransitPersonIds,
}: {
  people: RelationshipSurfacePerson[]
  mailInTransitPersonIds: Set<string>
}) {
  if (people.length === 0) {
    return (
      <div className="rounded-md border border-foreground/10 px-5 py-6">
        <p className="font-serif text-[17px] text-foreground">No correspondence yet.</p>
        <p className={`mt-1 ${helperTextClass}`}>
          When a first letter begins an exchange, that person will live here.
        </p>
      </div>
    )
  }

  const established = people.filter((person) => person.relationshipState === 'established')
  const pending = people.filter((person) => person.relationshipState === 'pending')
  const past = people.filter((person) => person.relationshipState === 'past')

  return (
    <div className="space-y-9">
      <RelationshipSection
        label="Correspondence"
        people={established}
        mailInTransitPersonIds={mailInTransitPersonIds}
      />
      <RelationshipSection
        label="First letters"
        people={pending}
        mailInTransitPersonIds={mailInTransitPersonIds}
      />
      <RelationshipSection
        label="Past correspondence"
        people={past}
        mailInTransitPersonIds={mailInTransitPersonIds}
      />
    </div>
  )
}

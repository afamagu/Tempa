import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'

/**
 * Shared Dispatch-author identity link — pseudonym (and identity mark)
 * wrapped in a real link to `/minds/[authorId]`, everywhere a Dispatch
 * lists its author. Locked TEMPA rule: a member's pseudonym/name must
 * link to that member's profile anywhere it appears as an identity
 * label — live testing found this missing on The Board and Home's
 * Board shelf (both previously rendered the author's Mindform/
 * pseudonym/flag as inert text, or nested it inside the card's own
 * navigation Link to the Dispatch itself, which would have made a
 * second link invalid HTML rather than simply adding one).
 *
 * Deliberately just the identity portion (Mark + pseudonym + country)
 * — never the date, which sits as a separate sibling text node outside
 * this link in every caller, since a date is metadata, not an identity
 * label. Callers are responsible for keeping this OUTSIDE any other
 * Link they render for the same card (e.g. the one to `/board/[id]`)
 * — nesting an anchor inside another anchor is invalid HTML and this
 * component does not defend against that itself.
 */
export default function DispatchAuthorLink({
  authorId,
  authorPseudonym,
  authorCountry,
  authorMarkUrl = null,
  size = 'sm',
}: {
  authorId: string
  authorPseudonym: string
  authorCountry: string | null
  authorMarkUrl?: string | null
  size?: 'sm' | 'md'
}) {
  return (
    <Link
      href={`/minds/${authorId}`}
      className="flex min-w-0 items-center gap-1.5 hover:opacity-80"
    >
      <ProfileIdentityMark
        identifier={authorId}
        markUrl={authorMarkUrl}
        label={authorMarkUrl ? `${authorPseudonym}'s Mark` : undefined}
        size={size}
      />
      <p className="truncate text-[14px] text-foreground/70">{authorPseudonym}</p>
      {authorCountry && (
        <span className="truncate text-[13px] text-muted" aria-label={`Country: ${authorCountry}`}>
          · {authorCountry}
        </span>
      )}
    </Link>
  )
}

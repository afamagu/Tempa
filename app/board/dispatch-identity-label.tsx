import TempaEmblem from '@/app/tempa-emblem'
import { SPONSORED_LABEL, type DispatchIdentity } from '@/lib/dispatch-identity'
import DispatchAuthorLink from './dispatch-author-link'

const EMBLEM_SIZE = { sm: 28, md: 36 } as const

/**
 * The ONE Dispatch identity renderer for every card/reader surface
 * (docs/sql/2026-10-15-official-sponsored-dispatches.sql):
 *
 *   member     — DispatchAuthorLink, completely unchanged (Mark,
 *                pseudonym, country, link to the member's profile).
 *   tempa      — the approved Tempa emblem + "Tempa". Not a link; no
 *                country; no member Mark.
 *   sponsored  — a quiet "Sponsored" disclosure + the sponsor's name.
 *                Not a link; never presented as Tempa or as a member.
 */
export default function DispatchIdentityLabel({
  identity,
  size = 'sm',
  linkable = true,
}: {
  identity: DispatchIdentity
  size?: 'sm' | 'md'
  /** false on the anonymous external reader, where no member profile
   * is reachable — the member identity is shown as plain text there. */
  linkable?: boolean
}) {
  if (identity.kind === 'tempa') {
    return (
      <span className="flex min-w-0 items-center gap-1.5" data-dispatch-identity="tempa">
        <TempaEmblem size={EMBLEM_SIZE[size]} className="shrink-0 rounded-md" />
        <span className={`truncate font-medium text-foreground ${size === 'md' ? 'text-[15px]' : 'text-[14px]'}`}>
          {identity.name}
        </span>
      </span>
    )
  }

  if (identity.kind === 'sponsored') {
    return (
      <span className="flex min-w-0 items-center gap-1.5" data-dispatch-identity="sponsored">
        <span className="shrink-0 rounded-full border border-foreground/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          {SPONSORED_LABEL}
        </span>
        <span className={`truncate text-foreground/80 ${size === 'md' ? 'text-[15px] font-medium' : 'text-[14px]'}`}>
          {identity.name}
        </span>
      </span>
    )
  }

  if (!linkable) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" data-dispatch-identity="member">
        <span className="truncate text-[14px] text-foreground/70">{identity.name}</span>
        {identity.country && <span className="truncate text-[13px] text-muted">· {identity.country}</span>}
      </span>
    )
  }

  return (
    <DispatchAuthorLink
      authorId={identity.authorId}
      authorPseudonym={identity.name}
      authorCountry={identity.country}
      authorMarkUrl={identity.markUrl}
      size={size}
    />
  )
}

/** The restrained external link a Sponsored Dispatch may carry. Only
 * ever rendered for an already-validated https:// URL. */
export function SponsorCta({ identity }: { identity: DispatchIdentity }) {
  if (identity.kind !== 'sponsored' || !identity.sponsor.ctaUrl) return null
  return (
    <a
      href={identity.sponsor.ctaUrl}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className="inline-flex items-center gap-1 text-[14px] font-medium text-foreground/80 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground"
    >
      {identity.sponsor.ctaLabel}
      <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens {identity.name}&rsquo;s site in a new tab)</span>
    </a>
  )
}

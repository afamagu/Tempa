import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { helperTextClass } from '@/app/profile/ui'
import EditorialByline from '@/app/editorial-byline'

export type RecommendedMind = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  markUrl?: string | null
  /** House accounts only ("Tempa House Columnist"). */
  editorialTitle?: string | null
}

/**
 * One Recommended Minds card — Mindform + pseudonym + demographics form
 * ONE accessible link to that person's public profile (never the
 * Minds/Question tutorial, never a write composer) — the normal result
 * of activating another member's identity everywhere Tempa presents
 * one as navigable.
 */
export default function RecommendedMindCard({ mind }: { mind: RecommendedMind }) {
  return (
    <Link
      href={`/minds/${mind.userId}`}
      className="flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-md p-2 text-center transition-colors hover:bg-foreground/[.03]"
    >
      <ProfileIdentityMark
        identifier={mind.userId}
        markUrl={mind.markUrl ?? null}
        label={mind.markUrl ? `${mind.pseudonym}'s Mark` : undefined}
        size="lg"
      />
      <span className="w-full truncate text-[13px] font-medium text-foreground">{mind.pseudonym}</span>
      {/* Borrows 4px of the card's padding each side so "Tempa House" holds one line. */}
      <EditorialByline title={mind.editorialTitle} wrap className="-mx-1 w-[calc(100%+0.5rem)]" />
      <span className={`w-full truncate ${helperTextClass}`}>
        {[mind.country, mind.genderDisplay].filter(Boolean).join(' · ')}
      </span>
    </Link>
  )
}

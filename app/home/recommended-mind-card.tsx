import Link from 'next/link'
import Mindform from '@/app/mindform'
import { helperTextClass } from '@/app/profile/ui'

export type RecommendedMind = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
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
      <Mindform identifier={mind.userId} size="lg" />
      <span className="w-full truncate text-[13px] font-medium text-foreground">{mind.pseudonym}</span>
      <span className={`w-full truncate ${helperTextClass}`}>
        {[mind.country, mind.genderDisplay].filter(Boolean).join(' · ')}
      </span>
    </Link>
  )
}

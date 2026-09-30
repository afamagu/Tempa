import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { helperTextClass } from '@/app/profile/ui'

export type RecommendedMind = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  markUrl?: string | null
}

/**
 * Compatibility card for Home's existing recommendation shelf while Home is
 * consolidated around Worth Knowing. Its destination is canonical immediately:
 * discovery now lives in The Room, never under the legacy /minds surface.
 */
export default function RecommendedMindCard({ mind }: { mind: RecommendedMind }) {
  return (
    <Link
      href={`/room/${mind.userId}?source=worth_knowing`}
      className="flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-md p-2 text-center transition-colors hover:bg-foreground/[.03]"
    >
      <ProfileIdentityMark
        identifier={mind.userId}
        markUrl={mind.markUrl ?? null}
        label={mind.markUrl ? `${mind.pseudonym}'s Mark` : undefined}
        size="lg"
      />
      <span className="w-full truncate text-[13px] font-medium text-foreground">{mind.pseudonym}</span>
      <span className={`w-full truncate ${helperTextClass}`}>
        {[mind.country, mind.genderDisplay].filter(Boolean).join(' · ')}
      </span>
    </Link>
  )
}

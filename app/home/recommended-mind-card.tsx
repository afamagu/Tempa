import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import AuthoredProse from '@/app/authored-prose'
import { helperTextClass } from '@/app/profile/ui'

export type RecommendedMind = {
  userId: string
  pseudonym: string
  country: string
  markUrl?: string | null
  responseBody: string
  writingStyleId?: string | null
}

/** Home's compact Worth Knowing encounter. The member's own words carry the
 * visual weight; Mark and country stay as quiet identity/context. */
export default function RecommendedMindCard({ mind }: { mind: RecommendedMind }) {
  return (
    <Link
      href={`/room/${mind.userId}?source=worth_knowing`}
      className="group block rounded-lg border border-foreground/10 p-5 transition-colors hover:border-foreground/20 hover:bg-foreground/[.015]"
    >
      <div className="flex items-center gap-3">
        <ProfileIdentityMark
          identifier={mind.userId}
          markUrl={mind.markUrl ?? null}
          label={mind.markUrl ? `${mind.pseudonym}'s Mark` : undefined}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground">{mind.pseudonym}</p>
          <p className={helperTextClass}>{mind.country}</p>
        </div>
      </div>

      <AuthoredProse styleId={mind.writingStyleId ?? null}>
        <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-[17px] leading-7 text-foreground/80">
          {mind.responseBody}
        </p>
      </AuthoredProse>
      <p className="mt-4 text-[12px] font-medium text-foreground/55 transition-colors group-hover:text-foreground/75">
        Read {mind.pseudonym} →
      </p>
    </Link>
  )
}

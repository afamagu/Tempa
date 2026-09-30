import Link from 'next/link'
import EditorialByline from '@/app/editorial-byline'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { helperTextClass } from '@/app/profile/ui'

export type RecommendedMind = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay?: string | null
  ageRange?: string
  markUrl?: string | null
  editorialTitle?: string | null
  responseBody?: string
}

/**
 * Home's compact Worth Knowing encounter. Once the Home mapper supplies the
 * authored response, those words are the reason to open the person; the Mark
 * and country remain quiet identity/context. The optional legacy fields keep
 * this component deploy-safe while Home is migrated in the same branch.
 */
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
          <EditorialByline title={mind.editorialTitle} />
          <p className={helperTextClass}>{mind.country}</p>
        </div>
      </div>

      {mind.responseBody ? (
        <p className="mt-4 line-clamp-4 whitespace-pre-wrap font-serif text-[17px] leading-7 text-foreground/80">
          {mind.responseBody}
        </p>
      ) : (
        <p className={`mt-4 ${helperTextClass}`}>Read what {mind.pseudonym} has shared in The Room.</p>
      )}
      <p className="mt-4 text-[12px] font-medium text-foreground/55 transition-colors group-hover:text-foreground/75">
        Read {mind.pseudonym} →
      </p>
    </Link>
  )
}

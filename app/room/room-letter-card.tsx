import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import FormattedText from '@/app/letters/formatted-text'
import AuthoredProse from '@/app/authored-prose'
import { dispatchExcerpt, dispatchIsRich, type BoardFeedItem } from '@/lib/dispatches'
import { roomLetterPath } from '@/lib/room-paths'

/**
 * A readable piece of stationery, not a pinned-paper metaphor or an
 * engagement tile. Only member writing enters The Room's main selection.
 */
export default function RoomLetterCard({
  letter,
  featured = false,
  returnTo,
  authorDetails,
}: {
  letter: BoardFeedItem
  featured?: boolean
  returnTo?: string
  authorDetails?: { gender: string | null; genderCustom: string | null; ageRange: string | null }
}) {
  const destination = `${roomLetterPath(letter.id)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`
  return (
    <article className={`group min-w-0 h-full rounded-[5px] border border-[#ded3c3] bg-[#fffdf8] px-6 py-7 shadow-[0_10px_28px_rgba(65,49,34,0.045)] transition-shadow hover:shadow-[0_12px_30px_rgba(65,49,34,0.09)] sm:px-8 sm:py-8 ${featured ? 'md:px-10 md:py-10' : ''}`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[.2em] text-[#9a7967]">
          A letter left here
        </span>
        <span className="text-[12px] text-[#8a7d70]" aria-hidden="true">✧</span>
      </div>
      <Link href={destination} className="mt-5 block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <h2 className={`font-serif font-normal leading-tight tracking-[-.025em] text-[#29261f] ${featured ? 'text-[29px] sm:text-[38px]' : 'text-[24px] sm:text-[28px]'}`}>
          {letter.title}
        </h2>
        <AuthoredProse styleId={letter.writingStyleId ?? null} size="compact">
          <p className={`mt-5 whitespace-pre-wrap leading-[1.75] text-[#4f4a43] ${featured ? 'line-clamp-4 text-[17px] sm:text-[19px]' : 'line-clamp-3 text-[16px]'}`}>
            <FormattedText text={dispatchExcerpt(letter.body)} isRich={dispatchIsRich(letter.body)} />
          </p>
        </AuthoredProse>
        <span className="mt-7 inline-block text-[13px] font-medium text-[#615a4f] underline-offset-4 transition-colors group-hover:text-[#344d3a] group-hover:underline">
          Read letter <span aria-hidden="true">→</span>
        </span>
      </Link>
      <div className="mt-7 flex min-w-0 items-center justify-between gap-4 border-t border-[#eae2d6] pt-4 text-[13px] text-[#686155]">
        <div className="min-w-0 space-y-1">
          <Link href={`/minds/${letter.authorId}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`} className="block truncate font-medium underline-offset-4 hover:underline">
            {letter.authorPseudonym}
          </Link>
          <p className="text-[12px] leading-relaxed text-[#786f63]">
            {[letter.authorCountry, authorDetails?.gender === 'Prefer not to say' ? null : authorDetails?.gender === 'Self-describe' ? authorDetails.genderCustom : authorDetails?.gender, authorDetails?.ageRange?.replace(/-/g, '–')].filter(Boolean).join(' · ')}
          </p>
        </div>
        <ProfileIdentityMark identifier={letter.authorId} markUrl={letter.authorMarkUrl ?? null} label={letter.authorMarkUrl ? `${letter.authorPseudonym}'s Mark` : undefined} size="xl" className="!h-[76px] !w-[76px] sm:!h-[88px] sm:!w-[88px]"/>
      </div>
    </article>
  )
}

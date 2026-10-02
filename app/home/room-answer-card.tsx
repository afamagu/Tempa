import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import EditorialByline from '@/app/editorial-byline'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { helperTextClass } from '@/app/profile/ui'

export type HomeRoomAnswer = {
  answerId?: string
  userId: string
  pseudonym: string
  country: string | null
  markUrl: string | null
  editorialTitle?: string | null
  body: string
}

export default async function RoomAnswerCard({ answer }: { answer: HomeRoomAnswer }) {
  const t = await getTranslations('RoomEngagement')
  return (
    <Link
      href={`/room/${answer.userId}?returnTo=%2Fhome${answer.answerId ? `&answer=${encodeURIComponent(answer.answerId)}` : ''}`}
      className="group block min-w-0 max-w-full rounded-lg border border-foreground/10 p-5 transition-colors hover:border-foreground/20 hover:bg-foreground/[.015]"
    >
      <div className="flex items-center gap-3">
        <ProfileIdentityMark
          identifier={answer.userId}
          markUrl={answer.markUrl}
          label={answer.markUrl ? `${answer.pseudonym}'s Mark` : undefined}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground">{answer.pseudonym}</p>
          <EditorialByline title={answer.editorialTitle} />
          {answer.country && <p className={helperTextClass}>{answer.country}</p>}
        </div>
      </div>

      <p className="mt-4 line-clamp-4 whitespace-pre-wrap font-serif text-[17px] leading-7 text-foreground/80">
        {answer.body}
      </p>
      <p className="mt-4 text-[12px] font-medium text-foreground/55 transition-colors group-hover:text-foreground/75">
        {t('readMember', { name: answer.pseudonym })}
      </p>
    </Link>
  )
}

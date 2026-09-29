import Link from 'next/link'
import Mindform from '@/app/mindform'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import CountryFlag from '@/app/country-flag'
import TopicChips from '@/app/board/topic-chips'
import DispatchBody from '@/app/board/dispatch-body'
import MomentHint from '@/app/board/moment-hint'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import { formatDatePlain } from '@/lib/format-date'
import {
  metadataTextClass,
  proseHeadingClass,
  systemBodyClass,
  primaryButtonClass,
} from '@/app/profile/ui'
import { dispatchPostcardToBaseContent, type SharedDispatch } from '@/lib/dispatches'
import DispatchIdentityLabel, { SponsorCta } from '@/app/board/dispatch-identity-label'

export default function SharedDispatchView({
  dispatch,
  isAuthenticated,
  writerInvitation = null,
  writingStyleId = null,
}: {
  dispatch: SharedDispatch
  isAuthenticated: boolean
  writerInvitation?: string | null
  /** The style the Dispatch was published in (null = Tempa's classic prose). */
  writingStyleId?: string | null
}) {
  const hasMoments = dispatch.moments.some((m) => m.imageUrl)

  return (
    <main className="flex justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>

        <div className="space-y-4">
          {dispatch.identity.kind === 'member' ? (
            <div className="flex items-center gap-3">
              {dispatch.identity.markUrl ? (
                <ProfileIdentityMark
                  identifier={dispatch.id}
                  markUrl={dispatch.identity.markUrl}
                  label={`${dispatch.authorPseudonym}'s Mark`}
                  size="md"
                />
              ) : (
                <Mindform identifier={dispatch.id} size="md" />
              )}
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[15px] font-medium text-foreground">{dispatch.authorPseudonym}</p>
                  <CountryFlag country={dispatch.authorCountry} />
                </div>
                <p className={metadataTextClass}>{formatDatePlain(dispatch.publishedAt)}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <DispatchIdentityLabel identity={dispatch.identity} size="md" linkable={false} />
              <p className={metadataTextClass}>{formatDatePlain(dispatch.publishedAt)}</p>
            </div>
          )}

          <h1 className={proseHeadingClass}>{dispatch.title}</h1>
          {dispatch.topics.length > 0 && <TopicChips topics={dispatch.topics} />}
          {hasMoments && <MomentHint dispatchId={dispatch.id} />}

          {dispatch.postcard && (
            <div className="flex justify-end">
              <LetterheadPostcard
                base={dispatchPostcardToBaseContent(dispatch.postcard.version)}
                revealLine={dispatch.postcard.revealLine}
                backMessage={dispatch.postcard.backMessage}
                senderPseudonym={dispatch.postcard.senderPseudonymSnapshot}
              />
            </div>
          )}

          <div className="rounded-md bg-surface-shell p-4 sm:p-6">
            <DispatchBody body={dispatch.body} moments={dispatch.moments} writingStyleId={writingStyleId} />
          </div>

          {dispatch.identity.kind === 'sponsored' && dispatch.identity.sponsor.ctaUrl && (
            <div className="flex justify-end">
              <SponsorCta identity={dispatch.identity} />
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-foreground/10 pt-6 text-center">
          {!isAuthenticated && writerInvitation && (
            <p className="text-[15px] font-medium text-foreground">Join Tempa to write to {writerInvitation}.</p>
          )}
          {!isAuthenticated && (
            <p className={systemBodyClass}>
              Tempa is a pen-pal experience built around thoughtful letters, shared questions, and glimpses
              from people&rsquo;s worlds. Meet minds worth writing to.
            </p>
          )}
          <Link href={isAuthenticated ? '/board' : '/sign-in?intent=join'} className={primaryButtonClass}>
            {isAuthenticated ? 'Go to The Board' : 'Join Tempa'}
          </Link>
        </div>
      </div>
    </main>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getMyLetters,
  excludeHiddenLetters,
  deriveArrivals,
  getHiddenCorrespondenceIds,
  getWaitingLetterCount,
  getIncomingMailInTransit,
  excludeHiddenMailInTransit,
  hasVisibleReply,
  hasIncomingMailInTransit,
  letterPreviewText,
  isRichBody,
} from '@/lib/letters'
import {
  getHomeBoardCandidates,
  partitionHomeSections,
  readingTrailSearchParams,
} from '@/lib/dispatches'
import { getActiveAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import {
  sectionLabelClass,
  pageTitleClass,
  helperTextClass,
  quietLinkClass,
  sectionTitleClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import RecommendedMindCard, { type RecommendedMind } from './recommended-mind-card'
import ArrivalSenderLink from './arrival-sender-link'
import BoardShelfCard from './board-shelf-card'
import AnnouncementTeaser from './announcement-teaser'
import KeptDispatchShelf from './kept-dispatch-shelf'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { getDiscoveryPage } from '@/lib/discovery'

const WORTH_KNOWING_COUNT = 3

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // One independent read round. Worth Knowing deliberately uses the SAME
  // bounded discovery RPC as The Room; Home is only a smaller presentation of
  // that pool, never a second recommendation system.
  const [
    { data: profile },
    allLettersRaw,
    waitingCount,
    incomingInTransitRaw,
    hiddenCorrespondenceIds,
    boardCandidates,
    activeAnnouncement,
    recommendedPage,
  ] = await Promise.all([
    supabase.from('profiles').select('pseudonym').eq('id', user.id).maybeSingle(),
    getMyLetters(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getHiddenCorrespondenceIds(supabase, user.id),
    getHomeBoardCandidates(supabase),
    getActiveAnnouncement(supabase),
    getDiscoveryPage(supabase, { offset: 0, limit: WORTH_KNOWING_COUNT }),
  ])

  if (!profile) redirect('/profile')

  const { items: boardItems, sessionStartedAt: boardSessionStartedAt, seed: boardSeed } = boardCandidates
  const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(boardItems)
  const [featuredLead, ...featuredSupporting] = featured

  function trailQueryFor(item: (typeof boardItems)[number]): string {
    return readingTrailSearchParams(
      { sessionStartedAt: boardSessionStartedAt, seed: boardSeed },
      item
    ).toString()
  }

  const allLetters = excludeHiddenLetters(allLettersRaw, hiddenCorrespondenceIds)
  const incomingInTransit = excludeHiddenMailInTransit(incomingInTransitRaw, hiddenCorrespondenceIds)
  const mailOnTheWay = hasIncomingMailInTransit(incomingInTransit)
  const awaitingReply = deriveArrivals(allLetters, user.id)
  const hasActiveCorrespondence = hasVisibleReply(allLetters)
  const singleAwaiting = awaitingReply.length === 1 ? awaitingReply[0] : null

  const [announcementImageUrl, singleAwaitingSender] = await Promise.all([
    activeAnnouncement?.heroImagePath
      ? resolveAnnouncementImageUrl(supabase, activeAnnouncement.heroImagePath).then((result) => result.url)
      : Promise.resolve(null),
    singleAwaiting
      ? supabase
          .from('public_profiles')
          .select('pseudonym, mark_id')
          .eq('id', singleAwaiting.senderId)
          .maybeSingle()
          .then(({ data }) =>
            data
              ? {
                  pseudonym: data.pseudonym as string,
                  markUrl: data.mark_id
                    ? publicProfileMarkUrl(supabase, `${data.mark_id}.png`)
                    : null,
                }
              : null
          )
      : Promise.resolve(null),
  ])

  const recommended: RecommendedMind[] = recommendedPage.candidates
    .slice(0, WORTH_KNOWING_COUNT)
    .map((candidate) => ({
      userId: candidate.userId,
      pseudonym: candidate.pseudonym,
      country: candidate.country,
      markUrl: candidate.markId
        ? publicProfileMarkUrl(supabase, `${candidate.markId}.png`)
        : null,
      responseBody: candidate.body,
    }))

  // A waiting letter is Tempa's strongest return signal. Do not place a
  // discovery invitation in competition with it on the same Home visit.
  const showWorthKnowing = awaitingReply.length === 0 && recommended.length > 0

  return (
    <AppShell active="home" waitingLetterCount={waitingCount}>
      <main className="min-h-screen p-6">
        <div className="py-10">
          <div className="mx-auto w-full max-w-md">
            <MemberNotices />
            <div className="space-y-6">
              <h1 className={pageTitleClass}>Arrivals</h1>

              {awaitingReply.length > 0 ? (
                <div className="space-y-2">
                  {singleAwaiting && singleAwaitingSender && (
                    <ArrivalSenderLink
                      senderId={singleAwaiting.senderId}
                      pseudonym={singleAwaitingSender.pseudonym}
                      markUrl={singleAwaitingSender.markUrl}
                    />
                  )}
                  <Link
                    href={singleAwaiting ? `/letters/${singleAwaiting.id}` : '/letters'}
                    className="block rounded-md border border-accent/40 px-5 py-5 transition-colors hover:border-accent/70"
                  >
                    <p className={sectionTitleClass}>
                      {awaitingReply.length === 1
                        ? '1 letter waiting'
                        : `${awaitingReply.length} letters waiting`}
                    </p>
                    <p className={`${helperTextClass} mt-1`}>Someone has written to you.</p>
                    {singleAwaiting && (
                      <div className="mt-2 rounded-md bg-surface-shell p-3">
                        <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[14px] leading-snug text-foreground/70">
                          <FormattedText
                            text={letterPreviewText(singleAwaiting.body)}
                            isRich={isRichBody(singleAwaiting.body)}
                          />
                        </p>
                      </div>
                    )}
                  </Link>
                </div>
              ) : hasActiveCorrespondence ? (
                <div className="rounded-md border border-foreground/10 px-5 py-5">
                  <p className={sectionTitleClass}>Your correspondence continues.</p>
                  <Link href="/letters" className={`${quietLinkClass} mt-2`}>
                    Open Letterbox
                  </Link>
                </div>
              ) : (
                <p className={helperTextClass}>Nothing waiting right now.</p>
              )}

              {mailOnTheWay && <MailOnTheWay />}
            </div>
          </div>

          {(boardItems.length > 0 || showWorthKnowing) && (
            <div className="mx-auto mt-14 w-full max-w-4xl">
              {boardItems.length > 0 && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className={sectionLabelClass}>From the Board</p>
                    <Link href="/board" className={quietLinkClass}>See all</Link>
                  </div>

                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {featuredLead && (
                      <div className="sm:col-span-2">
                        <BoardShelfCard
                          dispatch={featuredLead}
                          trailQuery={trailQueryFor(featuredLead)}
                          size="lead"
                        />
                      </div>
                    )}
                    {featuredSupporting.map((dispatch) => (
                      <BoardShelfCard
                        key={dispatch.id}
                        dispatch={dispatch}
                        trailQuery={trailQueryFor(dispatch)}
                      />
                    ))}
                  </div>

                  {fromMindsYouKeep.length > 0 && (
                    <div className="mt-14">
                      <p className={sectionLabelClass}>From Minds You Keep</p>
                      <div className="mt-3">
                        <KeptDispatchShelf
                          dispatches={fromMindsYouKeep}
                          trailQueryFor={trailQueryFor}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {showWorthKnowing && (
                <section className={boardItems.length > 0 ? 'mt-14' : ''} aria-labelledby="worth-knowing-heading">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className={sectionLabelClass}>Worth Knowing</p>
                      <h2 id="worth-knowing-heading" className="sr-only">People worth knowing</h2>
                      <p className={`mt-1 ${helperTextClass}`}>A few people, encountered through their words.</p>
                    </div>
                    <Link href="/room" className={quietLinkClass}>Read the Room</Link>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    {recommended.map((mind) => (
                      <RecommendedMindCard key={mind.userId} mind={mind} />
                    ))}
                  </div>
                </section>
              )}

              {serendipity.length > 0 && (
                <div className="mt-14">
                  <p className={sectionLabelClass}>A Little Serendipity</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    {serendipity.map((dispatch) => (
                      <BoardShelfCard
                        key={dispatch.id}
                        dispatch={dispatch}
                        trailQuery={trailQueryFor(dispatch)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeAnnouncement && (
            <div className="mx-auto mt-14 w-full max-w-md">
              <AnnouncementTeaser
                announcement={activeAnnouncement}
                imageUrl={announcementImageUrl}
              />
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

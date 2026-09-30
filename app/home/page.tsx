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
import { getCurrentRoomQuestion, getMyAnswers, getQuestionAnswerEncounters } from '@/lib/questions'
import { getActiveAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import {
  sectionLabelClass,
  pageTitleClass,
  helperTextClass,
  quietLinkClass,
  sectionTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import ArrivalSenderLink from './arrival-sender-link'
import BoardShelfCard from './board-shelf-card'
import RoomAnswerCard, { type HomeRoomAnswer } from './room-answer-card'
import AnnouncementTeaser from './announcement-teaser'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { editorialTitleFor, getEditorialBylines } from '@/lib/editorial-byline'

const HOME_ROOM_ANSWER_COUNT = 3
const HOME_BOARD_COUNT = 3

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [
    { data: profile },
    allLettersRaw,
    waitingCount,
    incomingInTransitRaw,
    hiddenCorrespondenceIds,
    boardCandidates,
    activeAnnouncement,
    currentRoomQuestion,
    myAnswers,
  ] = await Promise.all([
    supabase.from('profiles').select('pseudonym').eq('id', user.id).maybeSingle(),
    getMyLetters(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getHiddenCorrespondenceIds(supabase, user.id),
    getHomeBoardCandidates(supabase),
    getActiveAnnouncement(supabase),
    getCurrentRoomQuestion(supabase),
    getMyAnswers(supabase, user.id),
  ])

  if (!profile) redirect('/profile')

  const { items: boardItems, sessionStartedAt: boardSessionStartedAt, seed: boardSeed } = boardCandidates
  const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(boardItems)

  // Prefer three different writers on Home. If the pool is genuinely too
  // small, fill remaining positions from unused Dispatches rather than making
  // Home look empty.
  const homeBoardItems: typeof boardItems = []
  const seenBoardIds = new Set<string>()
  const seenBoardAuthors = new Set<string>()
  const preferredBoardItems = [featured[0], fromMindsYouKeep[0], serendipity[0], ...boardItems]

  for (const item of preferredBoardItems) {
    if (!item || seenBoardIds.has(item.id) || seenBoardAuthors.has(item.authorId)) continue
    homeBoardItems.push(item)
    seenBoardIds.add(item.id)
    seenBoardAuthors.add(item.authorId)
    if (homeBoardItems.length >= HOME_BOARD_COUNT) break
  }
  if (homeBoardItems.length < HOME_BOARD_COUNT) {
    for (const item of preferredBoardItems) {
      if (!item || seenBoardIds.has(item.id)) continue
      homeBoardItems.push(item)
      seenBoardIds.add(item.id)
      seenBoardAuthors.add(item.authorId)
      if (homeBoardItems.length >= HOME_BOARD_COUNT) break
    }
  }

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

  const primaryRoomAnswers = currentRoomQuestion
    ? await getQuestionAnswerEncounters(supabase, currentRoomQuestion.id, user.id, {
        excludeUserIds: [...seenBoardAuthors],
        limit: HOME_ROOM_ANSWER_COUNT,
      })
    : []

  const roomAnswers = [...primaryRoomAnswers]
  if (currentRoomQuestion && roomAnswers.length < HOME_ROOM_ANSWER_COUNT) {
    const fallback = await getQuestionAnswerEncounters(supabase, currentRoomQuestion.id, user.id, {
      limit: HOME_ROOM_ANSWER_COUNT,
    })
    const seen = new Set(roomAnswers.map((answer) => answer.userId))
    for (const answer of fallback) {
      if (seen.has(answer.userId)) continue
      roomAnswers.push(answer)
      seen.add(answer.userId)
      if (roomAnswers.length >= HOME_ROOM_ANSWER_COUNT) break
    }
  }

  const [announcementImageUrl, singleAwaitingSender, editorialBylines] = await Promise.all([
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
    getEditorialBylines(supabase),
  ])

  const homeRoomAnswers: HomeRoomAnswer[] = roomAnswers.map((answer) => ({
    userId: answer.userId,
    pseudonym: answer.pseudonym,
    country: answer.country,
    markUrl: answer.markId ? publicProfileMarkUrl(supabase, `${answer.markId}.png`) : null,
    editorialTitle: editorialTitleFor(editorialBylines, answer.pseudonym),
    body: answer.body,
  }))

  const currentRoomAnswer = currentRoomQuestion
    ? myAnswers.find((answer) => answer.questionId === currentRoomQuestion.id) ?? null
    : null

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

          {(currentRoomQuestion || homeBoardItems.length > 0) && (
            <div className="mx-auto mt-14 w-full max-w-4xl space-y-14">
              {currentRoomQuestion && (
                <section aria-labelledby="home-room-heading" className="space-y-6">
                  <div className="rounded-lg border border-foreground/10 bg-surface-shell p-6 sm:p-8">
                    <p className={sectionLabelClass}>This week in The Room</p>
                    <h2 id="home-room-heading" className="mt-3 max-w-3xl font-serif text-2xl leading-snug text-foreground sm:text-3xl">
                      {currentRoomQuestion.prompt}
                    </h2>
                    <div className="mt-6">
                      <Link href={`/question/${currentRoomQuestion.id}?source=home_room`} className={primaryButtonClass}>
                        {currentRoomAnswer ? 'Read or edit your answer' : 'Answer the Question'}
                      </Link>
                    </div>
                  </div>

                  {homeRoomAnswers.length > 0 && (
                    <div className="space-y-4">
                      <div>
                        <p className={sectionLabelClass}>See what people said</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        {homeRoomAnswers.map((answer) => (
                          <RoomAnswerCard key={answer.userId} answer={answer} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link href={`/room?question=${currentRoomQuestion.id}`} className={secondaryButtonClass}>
                      See more answers →
                    </Link>
                    <Link href="/room#read-the-room" className={quietLinkClass}>
                      Find someone worth writing to →
                    </Link>
                  </div>
                </section>
              )}

              {homeBoardItems.length > 0 && (
                <section aria-labelledby="home-board-heading">
                  <div className="flex items-center justify-between gap-3">
                    <p id="home-board-heading" className={sectionLabelClass}>From the Board</p>
                    <Link href="/board" className={quietLinkClass}>See all</Link>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    {homeBoardItems.map((dispatch) => (
                      <BoardShelfCard
                        key={dispatch.id}
                        dispatch={dispatch}
                        trailQuery={trailQueryFor(dispatch)}
                      />
                    ))}
                  </div>
                </section>
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

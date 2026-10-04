import PublicMentions from './public-mentions'
import RoomQuestionCredit from '@/app/member-questions/room-question-credit'
import Link from 'next/link'
import { cookies } from 'next/headers'
import IntroductionReminder from './introduction-reminder'
import { getIntroductionReminderQuestion } from '@/lib/introduction-reminder-query'
import { introductionReminderCookie, introductionReminderSnoozed } from '@/lib/introduction-reminder'
import { getTranslations } from 'next-intl/server'
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
  hasIncomingMailInTransit,
  letterPreviewText,
  isRichBody,
} from '@/lib/letters'
import { getRelationshipCapacity, correspondenceCapacitySummary } from '@/lib/relationship-capacity'
import { getRelationshipSurfacePeople } from '@/lib/relationship-surface'
import {
  getHomeBoardCandidates,
  partitionHomeSections,
  readingTrailSearchParams,
} from '@/lib/dispatches'
import { getCurrentRoomQuestion, getMyAnswers } from '@/lib/questions'
import { getHomeQuestionAnswers } from '@/lib/home-question-answers'
import { recordRoomExposureOpportunities } from '@/lib/room-exposure'
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
  metadataTextClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import ArrivalSenderLink from './arrival-sender-link'
import RoomInvitations from './room-invitations'
import BoardShelfCard from './board-shelf-card'
import RoomAnswerCard, { type HomeRoomAnswer } from './room-answer-card'
import AnnouncementTeaser from './announcement-teaser'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { editorialTitleFor, getEditorialBylines } from '@/lib/editorial-byline'
import ProfileIdentityMark from '@/app/profile-identity-mark'

const HOME_BOARD_COUNT = 3

export default async function HomePage() {
  const t = await getTranslations('RoomEngagement')
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
    introductionQuestion,
    relationshipCapacity,
    relationshipPeople,
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
    getIntroductionReminderQuestion(supabase, user.id),
    getRelationshipCapacity(supabase),
    getRelationshipSurfacePeople(supabase, user.id),
  ])

  if (!profile) redirect('/profile')

  const reminderSnoozed = introductionReminderSnoozed(
    (await cookies()).get(introductionReminderCookie(user.id))?.value
  )
  const capacitySummary = correspondenceCapacitySummary(relationshipCapacity)
  const establishedPeople = relationshipPeople.filter((person) => person.relationshipState === 'established')
  const pendingPeople = relationshipPeople.filter((person) => person.relationshipState === 'pending')

  const { items: boardItems, sessionStartedAt: boardSessionStartedAt, seed: boardSeed } = boardCandidates
  const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(boardItems)

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
  const singleAwaiting = awaitingReply.length === 1 ? awaitingReply[0] : null
  const relationshipByUserId = new Map(relationshipPeople.map((person) => [person.userId, person]))
  const singleAwaitingPerson = singleAwaiting ? relationshipByUserId.get(singleAwaiting.senderId) ?? null : null

  const roomCandidates = currentRoomQuestion
    ? await getHomeQuestionAnswers(supabase, user.id, currentRoomQuestion)
    : []
  await recordRoomExposureOpportunities(user.id, roomCandidates, 'home_room')

  const [announcementImageUrl, editorialBylines] = await Promise.all([
    activeAnnouncement?.heroImagePath
      ? resolveAnnouncementImageUrl(supabase, activeAnnouncement.heroImagePath).then((result) => result.url)
      : Promise.resolve(null),
    getEditorialBylines(supabase),
  ])

  const homeRoomAnswers: HomeRoomAnswer[] = roomCandidates.map((answer) => ({
    answerId: answer.answerId,
    userId: answer.userId,
    pseudonym: answer.pseudonym,
    country: answer.country || null,
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
          <div className="mx-auto w-full max-w-xl">
            <MemberNotices />
            <PublicMentions />

            <section aria-labelledby="what-matters-heading" className="space-y-6">
              <div>
                <p className={sectionLabelClass}>Home</p>
                <h1 id="what-matters-heading" className={`${pageTitleClass} mt-1`}>
                  What matters now
                </h1>
              </div>

              {awaitingReply.length > 0 && (
                <div className="space-y-2">
                  {singleAwaiting && singleAwaitingPerson && (
                    <ArrivalSenderLink
                      senderId={singleAwaiting.senderId}
                      pseudonym={singleAwaitingPerson.pseudonym}
                      markUrl={singleAwaitingPerson.markUrl ?? null}
                    />
                  )}
                  <Link
                    href={singleAwaiting ? `/letters/${singleAwaiting.id}` : '/letters'}
                    className="block rounded-md border border-accent/40 px-5 py-5 transition-colors hover:border-accent/70"
                  >
                    <p className={sectionTitleClass}>
                      {singleAwaiting && singleAwaitingPerson?.relationshipState === 'pending'
                        ? `A first letter from ${singleAwaitingPerson.pseudonym}`
                        : awaitingReply.length === 1
                          ? 'A letter is waiting'
                          : `${awaitingReply.length} letters are waiting`}
                    </p>
                    <p className={`${helperTextClass} mt-1`}>
                      {singleAwaitingPerson?.relationshipState === 'pending'
                        ? 'They would like to begin a correspondence.'
                        : 'Open it when you are ready to write back.'}
                    </p>
                    {singleAwaiting && (
                      <div className="mt-3 border-l-2 border-foreground/10 pl-3">
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
              )}

              {establishedPeople.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className={sectionLabelClass}>Your correspondence</p>
                    <Link href="/letters" className={quietLinkClass}>Open Letterbox</Link>
                  </div>
                  <div className="divide-y divide-foreground/10 border-y border-foreground/10">
                    {establishedPeople.slice(0, 5).map((person) => (
                      <Link
                        key={person.userId}
                        href={`/letters/with/${person.userId}`}
                        className="flex items-center gap-3 py-3.5 transition-colors hover:bg-foreground/[.02] sm:px-2"
                      >
                        <ProfileIdentityMark
                          identifier={person.userId}
                          markUrl={person.markUrl ?? null}
                          label={person.markUrl ? `${person.pseudonym}'s Mark` : undefined}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium text-foreground">{person.pseudonym}</p>
                          <p className={`truncate ${person.unreadCount > 0 ? 'text-[13px] font-medium text-accent' : metadataTextClass}`}>
                            {person.statusText}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {pendingPeople.some((person) => person.pendingDirection === 'outgoing') && (
                <div className="space-y-2">
                  <p className={sectionLabelClass}>First letters</p>
                  {pendingPeople
                    .filter((person) => person.pendingDirection === 'outgoing')
                    .slice(0, 2)
                    .map((person) => (
                      <Link
                        key={person.userId}
                        href={`/letters/with/${person.userId}`}
                        className="flex items-center justify-between gap-4 border-b border-foreground/10 py-3 last:border-b-0"
                      >
                        <span className="font-serif text-[15px] text-foreground">{person.pseudonym}</span>
                        <span className={`${metadataTextClass} text-right`}>{person.statusText}</span>
                      </Link>
                    ))}
                </div>
              )}

              {mailOnTheWay && <MailOnTheWay />}
              <RoomInvitations />

              {introductionQuestion && !reminderSnoozed && (
                <IntroductionReminder userId={user.id} questionId={introductionQuestion.id} />
              )}

              {capacitySummary && (
                <div className="border-l-2 border-accent/35 pl-4">
                  <p className={sectionLabelClass}>Your correspondence</p>
                  <p className={`mt-1 ${helperTextClass}`}>{capacitySummary}</p>
                </div>
              )}

              {awaitingReply.length === 0 && establishedPeople.length === 0 && pendingPeople.length === 0 && !mailOnTheWay && (
                <div className="rounded-md border border-foreground/10 px-5 py-5">
                  <p className={sectionTitleClass}>Nothing needs your attention right now.</p>
                  <p className={`${helperTextClass} mt-1`}>The Room and Board are still open whenever you feel like reading.</p>
                </div>
              )}
            </section>
          </div>

          {(currentRoomQuestion || homeRoomAnswers.length > 0 || homeBoardItems.length > 0) && (
            <div className="mx-auto mt-14 w-full max-w-4xl space-y-14">
              {currentRoomQuestion && (
                <section aria-labelledby="home-room-heading" className="space-y-6">
                  <div className="rounded-lg border border-foreground/10 bg-surface-shell p-6 sm:p-8">
                    <p className={sectionLabelClass}>{t('thisWeek')}</p>
                    <h2 id="home-room-heading" className="mt-3 max-w-3xl font-serif text-2xl leading-snug text-foreground sm:text-3xl">
                      {currentRoomQuestion.prompt}
                    </h2>
                    <RoomQuestionCredit questionId={currentRoomQuestion.id} />
                    <div className="mt-6">
                      <Link href={`/question/${currentRoomQuestion.id}?source=home_room`} className={primaryButtonClass}>
                        {currentRoomAnswer ? t('readEdit') : t('answerQuestion')}
                      </Link>
                    </div>
                  </div>

                  {homeRoomAnswers.length > 0 && (
                    <div className="space-y-4">
                      <p className={sectionLabelClass}>Three perspectives</p>
                      <div className="grid gap-4 md:grid-cols-3">
                        {homeRoomAnswers.map((answer) => (
                          <RoomAnswerCard key={answer.userId} answer={answer} />
                        ))}
                      </div>
                    </div>
                  )}

                  {homeRoomAnswers.length > 0 && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <Link href={`/room?question=${currentRoomQuestion.id}`} className={secondaryButtonClass}>
                        {t('moreAnswers')}
                      </Link>
                    </div>
                  )}
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
                      <BoardShelfCard key={dispatch.id} dispatch={dispatch} trailQuery={trailQueryFor(dispatch)} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeAnnouncement && (
            <div className="mx-auto mt-14 w-full max-w-md">
              <AnnouncementTeaser announcement={activeAnnouncement} imageUrl={announcementImageUrl} />
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

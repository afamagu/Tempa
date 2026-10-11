import PublicMentions from './public-mentions'
import Link from 'next/link'
import { cookies } from 'next/headers'
import IntroductionReminder from './introduction-reminder'
import { getIntroductionReminderQuestion } from '@/lib/introduction-reminder-query'
import { introductionReminderCookie, introductionReminderSnoozed } from '@/lib/introduction-reminder'
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
import { getActiveAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import {
  sectionLabelClass,
  pageTitleClass,
  helperTextClass,
  quietLinkClass,
  sectionTitleClass,
  metadataTextClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import ArrivalSenderLink from './arrival-sender-link'
import RoomInvitations from './room-invitations'
import BoardShelfCard from './board-shelf-card'
import AnnouncementTeaser from './announcement-teaser'
import ProfileIdentityMark from '@/app/profile-identity-mark'

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
  const establishedWithoutWaitingMail = establishedPeople.filter((person) => person.unreadCount === 0)
  const pendingPeople = relationshipPeople.filter((person) => person.relationshipState === 'pending')

  const { items: boardItems, sessionStartedAt: boardSessionStartedAt, seed: boardSeed } = boardCandidates
  const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(boardItems)

  const homeBoardItems: typeof boardItems = []
  const seenBoardIds = new Set<string>()
  const seenBoardAuthors = new Set<string>()
  const preferredBoardItems = [featured[0], fromMindsYouKeep[0], serendipity[0], ...boardItems].filter(item => item?.publishedAs === 'member')

  for (const item of preferredBoardItems) {
    if (!item || seenBoardIds.has(item.id) || seenBoardAuthors.has(item.authorId)) continue
    homeBoardItems.push(item)
    seenBoardIds.add(item.id)
    seenBoardAuthors.add(item.authorId)
    if (homeBoardItems.length >= HOME_BOARD_COUNT) break
  }
  if (homeBoardItems.length < HOME_BOARD_COUNT) {
    for (const item of preferredBoardItems) {
      if (!item || seenBoardIds.has(item.id) || seenBoardAuthors.has(item.authorId)) continue
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

  const announcementImageUrl = activeAnnouncement?.heroImagePath
    ? (await resolveAnnouncementImageUrl(supabase, activeAnnouncement.heroImagePath)).url
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

              {establishedWithoutWaitingMail.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className={sectionLabelClass}>Your correspondence</p>
                    <Link href="/letters" className={quietLinkClass}>Open Letterbox</Link>
                  </div>
                  <div className="divide-y divide-foreground/10 border-y border-foreground/10">
                    {establishedWithoutWaitingMail.slice(0, 5).map((person) => (
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
                          <p className={`truncate ${metadataTextClass}`}>{person.statusText}</p>
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
                  <p className={`${helperTextClass} mt-1`}>The Room is always open whenever you feel like reading.</p>
                </div>
              )}
            </section>
          </div>

          {homeBoardItems.length > 0 && (
            <div className="mx-auto mt-14 w-full max-w-4xl space-y-14">
              {homeBoardItems.length > 0 && (
                <section aria-labelledby="home-board-heading">
                  <div className="flex items-center justify-between gap-3">
                    <p id="home-board-heading" className={sectionLabelClass}>From the Room</p>
                    <Link href="/room" className={quietLinkClass}>Keep looking</Link>
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

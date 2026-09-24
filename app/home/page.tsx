import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getMyLetters,
  excludeHiddenLetters,
  deriveArrivals,
  getHiddenCorrespondenceIds,
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
  getIncomingMailInTransit,
  excludeHiddenMailInTransit,
  hasVisibleReply,
  hasIncomingMailInTransit,
  letterPreviewText,
  isRichBody,
} from '@/lib/letters'
import { getEligibleQuestions, getMyAnswers, needsParticipationGate } from '@/lib/questions'
import {
  getHomeBoardCandidates,
  partitionHomeSections,
  readingTrailSearchParams,
} from '@/lib/dispatches'
import { getActiveAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import { sectionLabelClass, pageTitleClass, helperTextClass, quietLinkClass, sectionTitleClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import MailOnTheWay from '@/app/mail-on-the-way'
import FormattedText from '@/app/letters/formatted-text'
import QuestionIncompleteNotice from '@/app/minds/question-incomplete-notice'
import RecommendedMindCard, { type RecommendedMind } from './recommended-mind-card'
import ArrivalSenderLink from './arrival-sender-link'
import BoardShelfCard from './board-shelf-card'
import AnnouncementTeaser from './announcement-teaser'
import KeptDispatchShelf from './kept-dispatch-shelf'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

const RECOMMENDED_COUNT = 6

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

// Same deterministic-per-viewer ordering technique as Minds/Explore
// (app/minds/page.tsx) — stable across a refresh, fair across viewers,
// no stored seed required.
function hashPair(viewerId: string, candidateId: string): number {
  let h = 2166136261
  const combined = `${viewerId}:${candidateId}`
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('pseudonym')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    redirect('/profile')
  }

  const [
    allLettersRaw,
    waitingCount,
    excludedPartnerIds,
    contactedAnswerIds,
    incomingInTransitRaw,
    hiddenCorrespondenceIds,
    eligibleQuestions,
    myAnswers,
    boardCandidates,
  ] = await Promise.all([
    getMyLetters(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getActiveCorrespondencePartnerIds(supabase, user.id),
    getContactedAnswerIds(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getHiddenCorrespondenceIds(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    getHomeBoardCandidates(supabase),
  ])

  const activeAnnouncement = await getActiveAnnouncement(supabase)
  const announcementImageUrl = activeAnnouncement?.heroImagePath
    ? (await resolveAnnouncementImageUrl(supabase, activeAnnouncement.heroImagePath)).url
    : null

  // Home Phase 1 (Editorial Reading Surface) — one candidate pool
  // (~HOME_CANDIDATE_COUNT rows from the SAME board_feed_page ranking
  // The Board itself uses), partitioned deterministically in
  // application code into Featured/Shelf/From Minds You
  // Keep/Serendipity — never a second ranking pass, never a Dispatch
  // repeated across sections (see partitionHomeSections's own comment).
  const { items: boardItems, sessionStartedAt: boardSessionStartedAt, seed: boardSeed } = boardCandidates
  const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(boardItems)

  // Reading Trail — every Home Dispatch link (cards AND the ON THE
  // BOARD strip) carries this SAME session plus its own item's cursor,
  // so the Dispatch detail page can offer Continue Reading with zero
  // new DB state (see lib/dispatches.ts's own "READING TRAIL" section).
  function trailQueryFor(item: (typeof boardItems)[number]): string {
    return readingTrailSearchParams({ sessionStartedAt: boardSessionStartedAt, seed: boardSeed }, item).toString()
  }

  const [featuredLead, ...featuredSupporting] = featured

  // "Remove from my Letterbox" means a correspondence no longer
  // surfaces in this viewer's ordinary personal mail surfaces at all —
  // Home included, not just the Letterbox screen. Same
  // hiddenCorrespondenceIds set and the same exclusion principle
  // Letterbox itself already applies (see lib/letters.ts).
  const allLetters = excludeHiddenLetters(allLettersRaw, hiddenCorrespondenceIds)
  const incomingInTransit = excludeHiddenMailInTransit(incomingInTransitRaw, hiddenCorrespondenceIds)
  const mailOnTheWay = hasIncomingMailInTransit(incomingInTransit)
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  const awaitingReply = deriveArrivals(allLetters, user.id)
  // A root letter's own `status` flips to 'replied' the instant its
  // reply is SENT, before Mail Call has necessarily delivered that
  // reply to this viewer — not safe as a "you have an ongoing
  // correspondence" signal on its own. allLetters is already sourced
  // from letters_for_participant (getMyLetters), so hasVisibleReply
  // checks for the reply letter's own presence instead.
  const hasActiveCorrespondence = hasVisibleReply(allLetters)
  const singleAwaiting = awaitingReply.length === 1 ? awaitingReply[0] : null

  // Only fetched for the single-sender case — with more than one
  // person waiting there's no single identity to attach a profile link
  // to, so none is shown (see PeopleGrid/DiscoveryResults for the same
  // "audit context, don't indiscriminately linkify" principle).
  let singleAwaitingSender: { pseudonym: string; markUrl: string | null } | null = null
  if (singleAwaiting) {
    const { data } = await supabase
      .from('public_profiles')
      .select('pseudonym, mark_id')
      .eq('id', singleAwaiting.senderId)
      .maybeSingle()
    singleAwaitingSender = data
      ? {
          pseudonym: data.pseudonym,
          markUrl: data.mark_id ? publicProfileMarkUrl(supabase, `${data.mark_id}.png`) : null,
        }
      : null
  }

  // A small, compact taste of Minds — not a second Discovery surface.
  // Same eligibility rule as Explore (current answer, not self, not
  // contacted, not an existing correspondence partner), just capped
  // tight and rendered without filters/pagination/full answer bodies.
  const { data: candidateAnswers } = await supabase
    .from('question_answers')
    .select('id, user_id')
    .eq('is_current', true)
    .neq('user_id', user.id)

  const eligibleUserIds = [
    ...new Set(
      (candidateAnswers ?? [])
        .filter((a) => !excludedPartnerIds.has(a.user_id) && !contactedAnswerIds.has(a.id))
        .map((a) => a.user_id)
    ),
  ]

  let recommended: RecommendedMind[] = []
  if (eligibleUserIds.length > 0) {
    const ordered = eligibleUserIds
      .map((id) => ({ id, h: hashPair(user.id, id) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, RECOMMENDED_COUNT)
      .map((x) => x.id)

    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range, mark_id')
      .in('id', ordered)

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
    recommended = ordered
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        userId: p.id,
        pseudonym: p.pseudonym,
        country: p.country,
        genderDisplay: genderDisplay(p.gender, p.gender_custom),
        ageRange: p.age_range,
        markUrl: p.mark_id ? publicProfileMarkUrl(supabase, `${p.mark_id}.png`) : null,
      }))
  }

  return (
    <AppShell active="home" waitingLetterCount={waitingCount}>
      <main className="min-h-screen p-6">
        <div className="py-10">
          {/* Home Phase 1B — hierarchy reorder: "What happened in my
              world?" (personal/attention content) comes first, then
              good writing (the editorial Board surface) immediately
              after — an ordinary Announcement is deliberately no longer
              among the first things a member sees; it moves to the very
              end of the page, after every reading section, so it can
              never dominate the first mobile viewport. Personal content
              stays in a comfortable narrow reading column, regardless of
              how wide the editorial Board surface below gets to be. */}
          <div className="mx-auto w-full max-w-md">
            <MemberNotices />
            <div className="space-y-6">
              <h1 className={pageTitleClass}>Arrivals</h1>

              {awaitingReply.length > 0 ? (
                <div className="space-y-2">
                  {/* The identity here is its own link to their profile,
                      deliberately separate from the card below (which
                      opens the letter itself) — clicking the person is
                      not the same intent as clicking "read this letter." */}
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

            {/* Home Phase 1 — QuestionIncompleteNotice moved up into the
                personal/attention group (same needsAnswer condition,
                unchanged behavior) rather than being stranded below the
                Board reading surface. */}
            {needsAnswer && (
              <div className="mt-10">
                <QuestionIncompleteNotice />
              </div>
            )}
          </div>

          {/* Home Phase 1 (Editorial Reading Surface) — the wide
              editorial Board reading surface: roughly 10-14 UNIQUE
              reading opportunities drawn from ONE board_feed_page
              candidate pool (the SAME ranking The Board itself uses,
              never a new algorithm, never semantic/interest matching —
              that is a later checkpoint), partitioned deterministically
              into sections that never repeat a Dispatch. This is NOT an
              infinite feed: no auto-loading, no "load more" here, a
              fixed set per render. Allowed to expand substantially
              beyond the narrow personal column above on desktop — see
              max-w-4xl below — while staying a single natural column on
              mobile.
              Home Phase 1B — Recommended Minds now lives INSIDE this
              same wide column too (between From Minds You Keep and A
              Little Serendipity, per the reordered hierarchy), so the
              whole "good writing" stretch of the page reads as one
              continuous width rather than narrow-wide-narrow-wide. The
              wrapper itself is guarded on EITHER pool being non-empty —
              Recommended Minds' own data is independent of Dispatches,
              so it must still render even in the rare case the Board
              candidate pool comes back empty. */}
          {(boardItems.length > 0 || recommended.length > 0) && (
            <div className="mx-auto mt-14 w-full max-w-4xl">
              {boardItems.length > 0 && (
                <>
              <div className="flex items-center justify-between gap-3">
                <p className={sectionLabelClass}>From the Board</p>
                <Link href="/board" className={quietLinkClass}>
                  See all
                </Link>
              </div>
              {/* Featured — one visually stronger lead card plus two
                  supporting cards on desktop (a calm editorial
                  composition, never a news-site grid); all three simply
                  stack on mobile. Same TEMPA card language throughout
                  (BoardShelfCard's own `size` variants), never a
                  different component. */}
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

              {/* A genuine shelf: compact identity/title rows from minds
                  the member deliberately kept, not another arbitrary
                  slice of Board cards under a personalized label. */}
              {fromMindsYouKeep.length > 0 && (
                <div className="mt-14">
                  <p className={sectionLabelClass}>From Minds You Keep</p>
                  <div className="mt-3">
                    <KeptDispatchShelf dispatches={fromMindsYouKeep} trailQueryFor={trailQueryFor} />
                  </div>
                </div>
              )}
                </>
              )}

              {/* Home Phase 1B — Recommended Minds, moved here per the
                  reordered hierarchy: after meaningful reading content
                  (Featured/Shelf/Kept writing), before A Little
                  Serendipity. Data/eligibility logic is completely
                  unchanged from Phase 1 — only its position and its
                  outer wrapper (now sharing the wide column instead of
                  its own narrow one) moved. */}
              {recommended.length > 0 && (
                <div className={boardItems.length > 0 ? 'mt-14' : ''}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={sectionLabelClass}>Recommended minds</p>
                    <Link href="/minds" className={quietLinkClass}>
                      See all
                    </Link>
                  </div>
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {recommended.map((r) => (
                      <RecommendedMindCard key={r.userId} mind={r} />
                    ))}
                  </div>
                </div>
              )}

              {/* A Little Serendipity — a Phase-1 broad-discovery proxy
                  only (non-kept, preferring unseen); deliberately never
                  described as "outside your interests," since Interests
                  don't exist yet. */}
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

          {/* Home Phase 1B — the ordinary Announcement teaser moves to
              the very end of the page, after every reading section —
              deliberately no longer among the first things a member
              sees, so it can never dominate the first mobile viewport.
              Behavior/content/component are completely unchanged (see
              announcement-teaser.tsx for this pass's own narrow
              proportion-only polish to its image). AnnouncementTeaser
              has no concept of urgency today, and this pass doesn't
              invent one — every current Announcement follows this same
              ordinary end-of-page placement. */}
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

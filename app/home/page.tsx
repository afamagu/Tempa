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
import { getCanonicalQuestions, getCanonicalAnswers, needsParticipationGate } from '@/lib/questions'
import { getHomeBoardDispatches, getFirstMomentThumbnails } from '@/lib/dispatches'
import { sectionLabelClass, helperTextClass, quietLinkClass, sectionTitleClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MailInTransitIcon from '@/app/mail-in-transit-icon'
import SystemMessage from '@/app/system-message'
import FormattedText from '@/app/letters/formatted-text'
import QuestionIncompleteNotice from '@/app/minds/question-incomplete-notice'
import RecommendedMindCard, { type RecommendedMind } from './recommended-mind-card'
import ArrivalSenderLink from './arrival-sender-link'
import BoardShelfCard from './board-shelf-card'

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
    canonicalQuestions,
    canonicalAnswers,
    boardShelf,
  ] = await Promise.all([
    getMyLetters(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getActiveCorrespondencePartnerIds(supabase, user.id),
    getContactedAnswerIds(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getHiddenCorrespondenceIds(supabase, user.id),
    getCanonicalQuestions(supabase),
    getCanonicalAnswers(supabase, user.id),
    getHomeBoardDispatches(supabase, user.id),
  ])

  const boardThumbnails = await getFirstMomentThumbnails(
    supabase,
    boardShelf.map((d) => d.id)
  )

  // "Remove from my Letterbox" means a correspondence no longer
  // surfaces in this viewer's ordinary personal mail surfaces at all —
  // Home included, not just the Letterbox screen. Same
  // hiddenCorrespondenceIds set and the same exclusion principle
  // Letterbox itself already applies (see lib/letters.ts).
  const allLetters = excludeHiddenLetters(allLettersRaw, hiddenCorrespondenceIds)
  const incomingInTransit = excludeHiddenMailInTransit(incomingInTransitRaw, hiddenCorrespondenceIds)
  const mailOnTheWay = hasIncomingMailInTransit(incomingInTransit)
  const needsAnswer = needsParticipationGate(canonicalQuestions.length, canonicalAnswers.length)

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
  let singleAwaitingSender: { pseudonym: string } | null = null
  if (singleAwaiting) {
    const { data } = await supabase
      .from('public_profiles')
      .select('pseudonym')
      .eq('id', singleAwaiting.senderId)
      .maybeSingle()
    singleAwaitingSender = data
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
      .select('id, pseudonym, country, gender, gender_custom, age_range')
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
      }))
  }

  return (
    <AppShell active="home" waitingLetterCount={waitingCount}>
      <main className="min-h-screen p-6">
        <div className="mx-auto w-full max-w-md py-10">
          <div className="space-y-6">
            <p className={sectionLabelClass}>Arrivals</p>

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

            {mailOnTheWay && (
              <SystemMessage
                variant="quiet"
                icon={<MailInTransitIcon className="h-3.5 w-3.5 text-foreground/50" />}
                title="Mail on the way"
              >
                A letter is travelling to you.
              </SystemMessage>
            )}
          </div>

          {/* The Board section — up to 3 WIDE Dispatch cards, stacked
              top-to-bottom (space-y-3), NEVER a carousel: no swipe, no
              drag, no auto-advance, no arrows. getHomeBoardDispatches
              is unseen-first (same tiering as The Board itself), so
              opening one and returning to Home naturally surfaces a
              different unseen Dispatch next time, with no separate
              Home-only "dismissed" state. The Board destination itself
              is where a member goes for more — this is a
              discoverability nudge only. */}
          {boardShelf.length > 0 && (
            <div className="mt-14">
              <div className="flex items-center justify-between gap-3">
                <p className={sectionLabelClass}>From the Board</p>
                <Link href="/board" className={quietLinkClass}>
                  See all
                </Link>
              </div>
              <div className="mt-3 space-y-3">
                {boardShelf.map((dispatch) => (
                  <BoardShelfCard key={dispatch.id} dispatch={dispatch} thumbnailUrl={boardThumbnails.get(dispatch.id)} />
                ))}
              </div>
            </div>
          )}

          {recommended.length > 0 && (
            <div className="mt-14 border-t border-foreground/10 pt-8">
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

          {needsAnswer && (
            <div className="mt-10">
              <QuestionIncompleteNotice />
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

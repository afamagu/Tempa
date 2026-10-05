import ProfileQuestions from '@/app/member-questions/profile-questions'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyAnswers } from '@/lib/questions'
import {
  getWaitingLetterCount,
  getFirstContact,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
} from '@/lib/letters'
import {
  getRelationshipCapacity,
  newCorrespondenceUnavailableMessage,
} from '@/lib/relationship-capacity'
import { getPublishedDispatchesByAuthor, getPinnedDispatch } from '@/lib/dispatches'
import { getBlockScope } from '@/lib/blocking'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import type { MyQuestionAnswer } from '@/lib/questions'
import {
  sectionTitleClass,
  sectionLabelClass,
  metadataTextClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  quietLinkClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileMarkViewer from './profile-mark-viewer'
import BlockButton from '@/app/block-button'
import ReportButton from '@/app/report-button'
import InterestsDisclosure from './interests-disclosure'
import ProfileAnswer from './profile-answer'
import { getMemberWritingStyles } from '@/lib/writing-style-data'
import { editorialTitleFor, getEditorialBylines } from '@/lib/editorial-byline'
import EditorialByline from '@/app/editorial-byline'
import OtherAnswersDisclosure from './other-answers-disclosure'
import DispatchCard from '../../board/dispatch-card'
import { introductionReturnPath } from '@/lib/introduction-navigation'
import { getPublicProfileCorrespondenceState } from '@/lib/profile-correspondence-state'
import { writingRhythmLabel } from '@/lib/writing-rhythm'
import { getCorrespondenceLifecycleWithMember } from '@/lib/correspondence-lifecycle'
import PeopleProfileBack from './people-profile-back'

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

export function canWriteToMind(state: {
  isSelf: boolean
  alreadyCorresponding: boolean
  hasCurrentAnswer: boolean
  currentAnswerAlreadyContacted: boolean
}): boolean {
  return !state.isSelf && !state.alreadyCorresponding && state.hasCurrentAnswer && !state.currentAnswerAlreadyContacted
}

/** Stable introduction first, then a live/historical Room response, then latest. */
export function chooseProfileAnswer(answers: MyQuestionAnswer[]): MyQuestionAnswer | null {
  return (
    answers.find((answer) => answer.isPrimary) ??
    answers.find((answer) => answer.isCurrent) ??
    [...answers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    null
  )
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ returnTo?: string; answer?: string }>
}) {
  const { userId } = await params
  const { returnTo, answer: selectedAnswerId } = await searchParams
  const originReturn = introductionReturnPath(returnTo)
  const profileContext = new URLSearchParams()
  if (originReturn) profileContext.set('returnTo', originReturn)
  if (typeof selectedAnswerId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedAnswerId)) profileContext.set('answer', selectedAnswerId)
  const profileReturn = profileContext.size ? `/room/${userId}?${profileContext}` : null
  const writeReturnQuery = profileReturn ? `&returnTo=${encodeURIComponent(profileReturn)}` : ''
  const supabase = await createClient()
  const { data: { user: viewer } } = await supabase.auth.getUser()
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(profileReturn ?? `/room/${userId}`)}`)

  const [{ data: profile }, waitingCount] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range, mark_id')
      .eq('id', userId)
      .maybeSingle(),
    getWaitingLetterCount(supabase, viewer.id),
  ])
  if (!profile) notFound()

  const { data: extra, error: extraError } = await supabase
    .from('public_profiles')
    .select('languages, intent')
    .eq('id', userId)
    .maybeSingle()
  const languages: string[] = extraError ? [] : extra?.languages ?? []
  const intent: string[] = extraError ? [] : extra?.intent ?? []
  const isSelf = viewer.id === userId

  const [rawAnswers, activePartnerIds, contactedAnswerIds, allDispatches, pinnedDispatch, blockScope, writingStyles, editorialBylines, firstContact, relationshipCapacity, publicCorrespondenceState, lifecycle] = await Promise.all([
    getMyAnswers(supabase, userId),
    isSelf ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, viewer.id),
    isSelf ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, viewer.id),
    getPublishedDispatchesByAuthor(supabase, userId),
    getPinnedDispatch(supabase, userId),
    isSelf ? Promise.resolve(null) : getBlockScope(supabase, userId),
    getMemberWritingStyles(supabase, [userId]),
    getEditorialBylines(supabase),
    isSelf ? Promise.resolve(null) : getFirstContact(supabase, viewer.id, userId),
    isSelf ? Promise.resolve(null) : getRelationshipCapacity(supabase),
    getPublicProfileCorrespondenceState(supabase, userId),
    isSelf ? Promise.resolve(null) : getCorrespondenceLifecycleWithMember(supabase, userId),
  ])
  const [{ data: memberQuestions }, { data: legacyQuestions }, incomingFirstContact] = await Promise.all([
    supabase.rpc('profile_member_questions', { p_owner: userId, p_offset: 0, p_limit: 12 }),
    isSelf ? supabase.rpc('my_unpublished_question_suggestions') : Promise.resolve({ data: [] }),
    isSelf ? Promise.resolve(null) : getFirstContact(supabase, userId, viewer.id),
  ])
  const writingStyleId = writingStyles.get(userId) ?? null
  const editorialTitle = editorialTitleFor(editorialBylines, profile.pseudonym)

  const recentDispatches = allDispatches.filter((d) => d.id !== pinnedDispatch?.id).slice(0, 3)
  // An explicit answer link must never silently open a different answer.
  const selectedAnswer = selectedAnswerId ? rawAnswers.find(answer => answer.id === selectedAnswerId) : null
  if (selectedAnswerId && !selectedAnswer) notFound()
  const primaryAnswer = selectedAnswer ?? chooseProfileAnswer(rawAnswers)
  const otherAnswers = rawAnswers
    .filter((answer) => answer.id !== primaryAnswer?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const writableAnswerIds = new Set<string>()
  if (!isSelf) {
    const checks = await Promise.all(
      rawAnswers
        .filter((answer) => answer.moderationStatus === 'visible')
        .map(async (answer) => {
          const { data } = await supabase.rpc('room_answer_can_start_letter', {
            p_answer: answer.id,
            p_author: userId,
          })
          return data === true ? answer.id : null
        })
    )
    for (const id of checks) if (id) writableAnswerIds.add(id)
  }
  const firstWriteAnchorId =
    rawAnswers.find((answer) => writableAnswerIds.has(answer.id))?.id ?? null
  const primaryWriteAnchor = primaryAnswer && writableAnswerIds.has(primaryAnswer.id) ? primaryAnswer : null
  const alreadyCorresponding = activePartnerIds.has(userId)
  const pausedCorrespondence = lifecycle?.status === 'paused' && lifecycle.establishedAt !== null
  const primaryAnswerAlreadyContacted = primaryAnswer ? contactedAnswerIds.has(primaryWriteAnchor?.id ?? primaryAnswer.id) : false
  const senderUnavailableMessage = newCorrespondenceUnavailableMessage(relationshipCapacity)
  const recipientUnavailableMessage =
    publicCorrespondenceState && !publicCorrespondenceState.canReceiveFirstContact
      ? `${profile.pseudonym} isn’t taking another first letter right now.`
      : null
  const firstContactUnavailableMessage = senderUnavailableMessage ?? recipientUnavailableMessage
  const canBeginNewCorrespondence = firstContactUnavailableMessage === null
  const structurallyCanWriteToMind = canWriteToMind({
    isSelf,
    alreadyCorresponding: alreadyCorresponding || pausedCorrespondence,
    hasCurrentAnswer: firstWriteAnchorId !== null,
    currentAnswerAlreadyContacted: primaryAnswerAlreadyContacted || firstContact !== null,
  })
  const showWriteToMind = structurallyCanWriteToMind && canBeginNewCorrespondence
  const hasPendingEpisode = !alreadyCorresponding && !pausedCorrespondence && (firstContact !== null || incomingFirstContact?.status === 'sent')
  const pendingLetterHref = hasPendingEpisode ? `/letters/${firstContact?.id ?? incomingFirstContact?.id}` : undefined
  const publicRhythmLabel = writingRhythmLabel(publicCorrespondenceState?.writingRhythm ?? null)
  const demographics = [profile.country, genderDisplay(profile.gender, profile.gender_custom), profile.age_range]
    .filter(Boolean)
    .join(' · ')
  const markUrl = profile.mark_id ? publicProfileMarkUrl(supabase, `${profile.mark_id}.png`) : null

  return (
    <AppShell active={isSelf ? 'you' : returnTo === '/home' ? 'home' : returnTo?.startsWith('/letters/discover') ? 'letters' : 'room'} waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          {!isSelf && <PeopleProfileBack returnTo={returnTo} />}

          <div className="flex items-start gap-4">
            <ProfileMarkViewer identifier={profile.id} markUrl={markUrl} pseudonym={profile.pseudonym} />
            <div className="min-w-0">
              <h1 className={sectionTitleClass}>{profile.pseudonym}</h1>
              <EditorialByline title={editorialTitle} rule className="mb-2" />
              {demographics && <p className={metadataTextClass}>{demographics}</p>}
              {languages.length > 0 && <p className={`mt-1 ${metadataTextClass}`}>Speaks {languages.join(', ')}</p>}
              {intent.length > 0 && (
                <div className="mt-2">
                  <p className={sectionLabelClass}>Interests</p>
                  <InterestsDisclosure items={intent} />
                </div>
              )}
            </div>
          </div>

          <ProfileQuestions key={`${userId}:${JSON.stringify(memberQuestions ?? [])}`} ownerId={userId} name={profile.pseudonym} own={isSelf} initial={memberQuestions ?? []} legacy={legacyQuestions ?? []}
            writeHref={isSelf ? null : alreadyCorresponding ? `/letters/with/${userId}/write` : hasPendingEpisode ? null : canBeginNewCorrespondence && eligibleAnswers?.[0] ? `/write/${userId}?a=${eligibleAnswers[0].id}` : null}
            pendingLetterHref={hasPendingEpisode ? `/letters/${firstContact?.id ?? incomingFirstContact?.id}` : undefined}
            writeUnavailableMessage={!isSelf && !alreadyCorresponding && !hasPendingEpisode ? newCorrespondenceMessage : null}
            returnTo={profileReturn ?? `/room/${userId}`} />

          {primaryAnswer && (
            <div className="space-y-6">
              {primaryAnswer.moderationStatus === 'hidden' ? (
                <div className="rounded-md border border-foreground/10 p-4">
                  <p className={metadataTextClass}>Hidden by TEMPA.</p>
                </div>
              ) : (
                <ProfileAnswer
                  id={primaryAnswer.id}
                  prompt={primaryAnswer.prompt}
                  body={primaryAnswer.body}
                  isPrimary={primaryAnswer.isPrimary}
                  showReport={!isSelf}
                  writingStyleId={writingStyleId}
                />
              )}
            </div>
          )}

          <OtherAnswersDisclosure
            answers={otherAnswers}
            showReport={!isSelf}
            ownerPseudonym={profile.pseudonym}
            isSelf={isSelf}
            writingStyleId={writingStyleId}
          />

          {pinnedDispatch && (
            <div className="space-y-3 border-t border-foreground/10 pt-6">
              <p className={sectionLabelClass}>Pinned</p>
              <DispatchCard dispatch={pinnedDispatch} />
            </div>
          )}

          {allDispatches.length > 0 && (
            <div className="space-y-3 border-t border-foreground/10 pt-6">
              <div className="flex items-center justify-between gap-3">
                <p className={sectionLabelClass}>Dispatches</p>
                <Link href={`/room/${userId}/dispatches`} className={quietLinkClass}>See all Dispatches</Link>
              </div>
              {recentDispatches.length > 0 && (
                <div className="space-y-4">
                  {recentDispatches.map((dispatch) => <DispatchCard key={dispatch.id} dispatch={dispatch} />)}
                </div>
              )}
            </div>
          )}

          {!isSelf && (
            <div className="space-y-3">
              {showWriteToMind && primaryWriteAnchor ? (
                <Link href={`/write/${profile.id}?a=${primaryWriteAnchor.id}&source=room_profile${writeReturnQuery}`} className={primaryButtonClass}>
                  Write to {profile.pseudonym}
                </Link>
              ) : alreadyCorresponding ? (
                <Link href="/letters" className={secondaryButtonClass}>
                  Open your correspondence with {profile.pseudonym}
                </Link>
              ) : firstContact ? (
                <Link href={`/letters/${firstContact.id}`} className={secondaryButtonClass}>View your letter to {profile.pseudonym}</Link>
              ) : structurallyCanWriteToMind && newCorrespondenceMessage ? (
                <div className="space-y-1">
                  <p className={sectionLabelClass}>Room for someone new</p>
                  <p className={helperTextClass}>{newCorrespondenceMessage}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-4">
                <BlockButton
                  blockedId={profile.id}
                  blockedPseudonym={profile.pseudonym}
                  triggerClassName={quietLinkClass}
                  initialScope={blockScope}
                  fullBlockRedirect="/room"
                />
                <ReportButton targetType="profile" targetId={profile.id} triggerClassName={quietLinkClass} />
              </div>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyAnswers } from '@/lib/questions'
import {
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
} from '@/lib/letters'
import { getPublishedDispatchesByAuthor, getPinnedDispatch } from '@/lib/dispatches'
import { getBlockScope } from '@/lib/blocking'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import type { MyQuestionAnswer } from '@/lib/questions'
import {
  sectionTitleClass,
  sectionLabelClass,
  metadataTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  quietLinkClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import Mindform from '@/app/mindform'
import BlockButton from '@/app/block-button'
import ReportButton from '@/app/report-button'
import InterestsDisclosure from './interests-disclosure'
import ProfileAnswer from './profile-answer'
import OtherAnswersDisclosure from './other-answers-disclosure'
import DispatchCard from '../../board/dispatch-card'
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
  return (
    !state.isSelf &&
    !state.alreadyCorresponding &&
    state.hasCurrentAnswer &&
    !state.currentAnswerAlreadyContacted
  )
}

/** The same continuity rule used by People discovery, expressed over the
 * resolved profile-answer shape: Flagship first, then the member's historical
 * current response, then their latest response. This keeps established users
 * readable after a Flagship rotation without weakening response-first People. */
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
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { userId } = await params
  const { returnTo } = await searchParams
  const supabase = await createClient()
  const { data: { user: viewer } } = await supabase.auth.getUser()
  if (!viewer) redirect('/sign-in')

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

  const [rawAnswers, activePartnerIds, contactedAnswerIds, allDispatches, pinnedDispatch, blockScope] = await Promise.all([
    getMyAnswers(supabase, userId),
    isSelf ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, viewer.id),
    isSelf ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, viewer.id),
    getPublishedDispatchesByAuthor(supabase, userId),
    getPinnedDispatch(supabase, userId),
    isSelf ? Promise.resolve(null) : getBlockScope(supabase, userId),
  ])

  const recentDispatches = allDispatches.filter((d) => d.id !== pinnedDispatch?.id).slice(0, 3)
  const primaryAnswer = chooseProfileAnswer(rawAnswers)
  const otherAnswers = rawAnswers
    .filter((answer) => answer.id !== primaryAnswer?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const alreadyCorresponding = activePartnerIds.has(userId)
  const primaryAnswerAlreadyContacted = primaryAnswer ? contactedAnswerIds.has(primaryAnswer.id) : false
  const showWriteToMind = canWriteToMind({
    isSelf,
    alreadyCorresponding,
    hasCurrentAnswer: primaryAnswer !== null,
    currentAnswerAlreadyContacted: primaryAnswerAlreadyContacted,
  })
  const demographics = [profile.country, genderDisplay(profile.gender, profile.gender_custom), profile.age_range]
    .filter(Boolean)
    .join(' · ')
  const markUrl = profile.mark_id ? publicProfileMarkUrl(supabase, `${profile.mark_id}.png`) : null

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          {!isSelf && <PeopleProfileBack returnTo={returnTo} />}

          <div className="flex items-start gap-4">
            {markUrl ? (
              <div
                role="img"
                aria-label={`${profile.pseudonym}'s Mark`}
                className="h-14 w-14 shrink-0 rounded-full border border-foreground/10 bg-cover bg-center shadow-sm"
                style={{ backgroundImage: `url(${markUrl})` }}
              />
            ) : (
              <Mindform identifier={profile.id} size="lg" />
            )}
            <div className="min-w-0">
              <h1 className={sectionTitleClass}>{profile.pseudonym}</h1>
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
                />
              )}
            </div>
          )}

          <OtherAnswersDisclosure
            answers={otherAnswers}
            showReport={!isSelf}
            ownerPseudonym={profile.pseudonym}
            isSelf={isSelf}
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
                <Link href={`/minds/${userId}/dispatches`} className={quietLinkClass}>See all Dispatches</Link>
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
              {showWriteToMind && primaryAnswer ? (
                <Link href={`/write/${profile.id}?a=${primaryAnswer.id}`} className={primaryButtonClass}>
                  Write to {profile.pseudonym}
                </Link>
              ) : alreadyCorresponding ? (
                <Link href="/letters" className={secondaryButtonClass}>
                  Open your correspondence with {profile.pseudonym}
                </Link>
              ) : null}

              <div className="flex flex-wrap items-center gap-4">
                <BlockButton
                  blockedId={profile.id}
                  blockedPseudonym={profile.pseudonym}
                  triggerClassName={quietLinkClass}
                  initialScope={blockScope}
                  fullBlockRedirect="/minds"
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

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

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

/**
 * Pure: whether this profile should offer "Write to this mind" — never
 * for your own profile, never while already corresponding, never
 * without a current answer to write against, and never a second time
 * against the same current answer. Split out from the page body so the
 * self-profile ("never offered on your own profile") and non-self
 * ("still offered") cases are directly testable without a database.
 */
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

/**
 * Tempa's first public member-profile surface. Deliberately restrained:
 * an identity, a few already-public onboarding facts, current and
 * historical published writing, and — when it genuinely applies — one
 * way to start a correspondence. No followers, no likes, no counts
 * presented as popularity.
 *
 * Fields are an explicit allowlist, never a full-row select. `languages`
 * and `intent` additionally depend on
 * docs/sql/2026-08-31-public-profile-fields.sql, which is prepared but
 * not yet applied — that second query is allowed to fail gracefully
 * (see below) so the rest of the profile still renders correctly either
 * way.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const supabase = await createClient()
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser()

  if (!viewer) {
    redirect('/sign-in')
  }

  const [{ data: profile }, waitingCount] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range')
      .eq('id', userId)
      .maybeSingle(),
    getWaitingLetterCount(supabase, viewer.id),
  ])

  if (!profile) {
    notFound()
  }

  // Optional, additive fields — tolerate the extending migration not
  // having been run yet rather than breaking the whole profile.
  const { data: extra, error: extraError } = await supabase
    .from('public_profiles')
    .select('languages, intent')
    .eq('id', userId)
    .maybeSingle()
  const languages: string[] = extraError ? [] : extra?.languages ?? []
  const intent: string[] = extraError ? [] : extra?.intent ?? []

  const isSelf = viewer.id === userId

  // Viewing a public profile — anyone's, including your own — is never
  // gated on having answered a Question yourself. Answering is
  // encouraged (a non-blocking indicator on /minds) but never a
  // navigation requirement: a member may browse Minds, open a profile,
  // and read someone's published answer with nothing else required.
  const [rawAnswers, activePartnerIds, contactedAnswerIds, allDispatches, pinnedDispatch, blockScope] = await Promise.all([
    getMyAnswers(supabase, userId),
    isSelf ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, viewer.id),
    isSelf ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, viewer.id),
    getPublishedDispatchesByAuthor(supabase, userId),
    getPinnedDispatch(supabase, userId),
    isSelf ? Promise.resolve(null) : getBlockScope(supabase, userId),
  ])

  // Writing hierarchy (Board usability checkpoint, 2026-09-09): Question
  // answers first (unchanged — "how this person thinks" stays
  // foundational), then the pinned Dispatch if one exists, then recent
  // Dispatches newest-first, excluding the pinned one so it's never
  // shown twice on the same profile.
  const recentDispatches = allDispatches.filter((d) => d.id !== pinnedDispatch?.id).slice(0, 3)

  // Question Slots checkpoint (Section A4) — the PRIMARY answer is
  // always and only the answer to whichever Question currently holds
  // position #1, never an arbitrary/most-recent/is_current answer.
  // Everything else this member has answered is "other answers,"
  // sorted most-recently-written first (a neutral, existing field,
  // never an invented ranking signal), behind a restrained disclosure.
  const primaryAnswer = rawAnswers.find((a) => a.isPrimary) ?? null
  const otherAnswers = rawAnswers
    .filter((a) => !a.isPrimary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const alreadyCorresponding = activePartnerIds.has(userId)
  const primaryAnswerAlreadyContacted = primaryAnswer
    ? contactedAnswerIds.has(primaryAnswer.id)
    : false
  const showWriteToMind = canWriteToMind({
    isSelf,
    alreadyCorresponding,
    hasCurrentAnswer: primaryAnswer !== null,
    currentAnswerAlreadyContacted: primaryAnswerAlreadyContacted,
  })

  const demographics = [profile.country, genderDisplay(profile.gender, profile.gender_custom), profile.age_range]
    .filter(Boolean)
    .join(' · ')

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <div className="flex items-start gap-4">
            <Mindform identifier={profile.id} size="lg" />
            <div className="min-w-0">
              <h1 className={sectionTitleClass}>{profile.pseudonym}</h1>
              {demographics && <p className={metadataTextClass}>{demographics}</p>}
              {languages.length > 0 && (
                <p className={`mt-1 ${metadataTextClass}`}>Speaks {languages.join(', ')}</p>
              )}
              {intent.length > 0 && (
                <div className="mt-2">
                  {/* "Interests" is a deliberately provisional label —
                      see the Build Guide's conversation-territory note
                      for where this heading/categorization is headed. */}
                  <p className={sectionLabelClass}>Interests</p>
                  <InterestsDisclosure items={intent} />
                </div>
              )}
            </div>
          </div>

          {primaryAnswer && (
            <div className="space-y-6">
              {/* A 'hidden' answer only ever reaches this array for the
                  answer's own author — question_answers' cross-user RLS
                  policy already excludes it entirely for anyone else
                  (Admin Phase 2A-1). This is exactly the "appropriate
                  own-context" Decision 2/9 describes: a calm, private
                  notice on the author's own profile view, never a
                  public tombstone. */}
              {primaryAnswer.moderationStatus === 'hidden' ? (
                <div className="rounded-md border border-foreground/10 p-4">
                  <p className={metadataTextClass}>Hidden by TEMPA.</p>
                </div>
              ) : (
                <ProfileAnswer
                  id={primaryAnswer.id}
                  prompt={primaryAnswer.prompt}
                  body={primaryAnswer.body}
                  isPrimary
                  showReport={!isSelf}
                />
              )}
            </div>
          )}

          <OtherAnswersDisclosure answers={otherAnswers} showReport={!isSelf} />

          {/* Pinned Dispatch — shown only when this person has pinned
              one, always ahead of their other recent writing. Never a
              pin count, never a ranking signal beyond this one slot. */}
          {pinnedDispatch && (
            <div className="space-y-3 border-t border-foreground/10 pt-6">
              <p className={sectionLabelClass}>Pinned</p>
              <DispatchCard dispatch={pinnedDispatch} />
            </div>
          )}

          {/* Restrained — a heading and up to three, never the full
              Board chrome, so this doesn't compete with the profile's
              own writing (canonical answers) for attention. Hidden
              entirely when empty, never an empty "Dispatches" section
              with nothing under it. */}
          {allDispatches.length > 0 && (
            <div className="space-y-3 border-t border-foreground/10 pt-6">
              <div className="flex items-center justify-between gap-3">
                <p className={sectionLabelClass}>Dispatches</p>
                <Link href={`/minds/${userId}/dispatches`} className={quietLinkClass}>
                  See all Dispatches
                </Link>
              </div>
              {recentDispatches.length > 0 && (
                <div className="space-y-4">
                  {recentDispatches.map((dispatch) => (
                    <DispatchCard key={dispatch.id} dispatch={dispatch} />
                  ))}
                </div>
              )}
            </div>
          )}

          {!isSelf && (
            <div className="space-y-3">
              {showWriteToMind && primaryAnswer ? (
                <Link
                  href={`/write/${profile.id}?a=${primaryAnswer.id}`}
                  className={primaryButtonClass}
                >
                  Write to this mind
                </Link>
              ) : alreadyCorresponding ? (
                <Link href="/letters" className={secondaryButtonClass}>
                  Open your correspondence
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

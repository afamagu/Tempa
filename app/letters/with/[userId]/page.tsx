import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetterArchiveWithUser,
  getVisibleCorrespondenceIdsWithUser,
  getWaitingLetterCount,
  getIncomingMailInTransit,
  incomingMailInTransitPersonIds,
  getActiveEstablishedCorrespondenceWithUser,
  isEstablishedForViewer,
} from '@/lib/letters'
import {
  getCorrespondenceRhythm,
  getMyWritingRhythm,
} from '@/lib/writing-rhythm'
import { getReturnCardsForCorrespondences } from '@/lib/return-cards'
import { sectionTitleClass, iconButtonClass, metadataTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import MailOnTheWay from '@/app/mail-on-the-way'
import RemoveFromLetterbox from '@/app/letters/remove-from-letterbox'
import RemoveFromLetterboxIcon from '@/app/letters/remove-from-letterbox-icon'
import ArchiveList from './archive-list'
import ReturnCardHistory from './return-card-history'
import WriteQuillButton from './write-quill-button'
import CorrespondenceRhythmControl from './correspondence-rhythm-control'
import CorrespondenceLifecycleControl from './correspondence-lifecycle-control'
import { getCorrespondenceLifecycleWithMember } from '@/lib/correspondence-lifecycle'

function BackChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  )
}

export default async function LetterArchiveWithUserPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId: otherUserId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')
  if (otherUserId === user.id) redirect('/letters')

  const [
    { data: profiles },
    letters,
    waitingCount,
    visibleCorrespondenceIds,
    incomingInTransit,
    activeCorrespondence,
    myRhythm,
    lifecycle,
  ] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, pseudonym, mark_id')
      .in('id', [user.id, otherUserId]),
    getLetterArchiveWithUser(supabase, user.id, otherUserId),
    getWaitingLetterCount(supabase, user.id),
    getVisibleCorrespondenceIdsWithUser(supabase, user.id, otherUserId),
    getIncomingMailInTransit(supabase),
    getActiveEstablishedCorrespondenceWithUser(supabase, user.id, otherUserId),
    getMyWritingRhythm(supabase),
    getCorrespondenceLifecycleWithMember(supabase, otherUserId),
  ])

  const otherProfile = (profiles ?? []).find((p) => p.id === otherUserId) ?? null
  const hasHistoricalAccess = letters.length > 0 || visibleCorrespondenceIds.length > 0
  if (!otherProfile && !hasHistoricalAccess) notFound()

  const viewerPseudonym = (profiles ?? []).find((p) => p.id === user.id)?.pseudonym ?? 'You'
  const otherPseudonym = otherProfile?.pseudonym ?? 'A Tempa member'
  const otherMarkUrl = otherProfile?.mark_id
    ? publicProfileMarkUrl(supabase, `${otherProfile.mark_id}.png`)
    : null
  const mailOnTheWayFromThisPerson = incomingMailInTransitPersonIds(incomingInTransit).has(otherUserId)

  const establishedForViewer = activeCorrespondence
    ? await isEstablishedForViewer(supabase, activeCorrespondence.id)
    : false
  const correspondenceRhythm = activeCorrespondence && establishedForViewer
    ? await getCorrespondenceRhythm(supabase, activeCorrespondence.id)
    : null
  const returnCards = await getReturnCardsForCorrespondences(supabase, visibleCorrespondenceIds)

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-2xl">
          <Link
            href="/letters"
            aria-label="Back to Letterbox"
            className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-foreground"
          >
            <BackChevronIcon />
            Letterbox
          </Link>

          <div className="mb-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              {otherProfile ? (
                <Link
                  href={`/room/${otherProfile.id}`}
                  className="flex min-w-0 items-center gap-3 rounded-md transition-opacity hover:opacity-80"
                >
                  <ProfileIdentityMark
                    identifier={otherProfile.id}
                    markUrl={otherMarkUrl}
                    label={otherMarkUrl ? `${otherProfile.pseudonym}'s Mark` : undefined}
                    size="md"
                  />
                  <h1 className={sectionTitleClass}>{otherProfile.pseudonym}</h1>
                </Link>
              ) : (
                <div className="min-w-0 space-y-1">
                  <h1 className={sectionTitleClass}>{otherPseudonym}</h1>
                  <p className={metadataTextClass}>This profile is no longer available. Your letters remain here.</p>
                </div>
              )}

              {visibleCorrespondenceIds.length > 0 && (
                <RemoveFromLetterbox
                  correspondenceIds={visibleCorrespondenceIds}
                  triggerClassName={`shrink-0 ${iconButtonClass}`}
                  triggerIcon={<RemoveFromLetterboxIcon />}
                  confirmDescription={`your correspondence with ${otherPseudonym}`}
                />
              )}
            </div>

            {mailOnTheWayFromThisPerson && <MailOnTheWay />}

            {lifecycle && otherProfile && (
              <CorrespondenceLifecycleControl
                lifecycle={lifecycle}
                viewerId={user.id}
                counterpartPseudonym={otherProfile.pseudonym}
              />
            )}

            {activeCorrespondence && establishedForViewer && correspondenceRhythm && otherProfile && (
              <div className="rounded-md border border-foreground/10 px-4 py-3">
                <CorrespondenceRhythmControl
                  correspondenceId={activeCorrespondence.id}
                  counterpartPseudonym={otherProfile.pseudonym}
                  defaultRhythm={myRhythm?.rhythm ?? null}
                  initialViewerRhythm={correspondenceRhythm.viewerRhythm}
                  initialUsesOverride={correspondenceRhythm.viewerUsesOverride}
                  counterpartRhythm={correspondenceRhythm.counterpartRhythm}
                />
              </div>
            )}
          </div>

          <ReturnCardHistory
            cards={returnCards}
            viewerId={user.id}
            otherPseudonym={otherPseudonym}
          />

          <ArchiveList
            letters={letters}
            viewerId={user.id}
            otherUserId={otherUserId}
            otherPseudonym={otherPseudonym}
            viewerPseudonym={viewerPseudonym}
          />
        </div>
      </main>
      {otherProfile && activeCorrespondence && establishedForViewer && (
        <WriteQuillButton otherUserId={otherProfile.id} otherPseudonym={otherProfile.pseudonym} />
      )}
    </AppShell>
  )
}

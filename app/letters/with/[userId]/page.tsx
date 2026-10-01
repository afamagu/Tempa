import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetterArchiveWithUser,
  getVisibleCorrespondenceIdsWithUser,
  getWaitingLetterCount,
  getIncomingMailInTransit,
  incomingMailInTransitPersonIds,
} from '@/lib/letters'
import { sectionTitleClass, iconButtonClass, metadataTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import MailOnTheWay from '@/app/mail-on-the-way'
import RemoveFromLetterbox from '@/app/letters/remove-from-letterbox'
import RemoveFromLetterboxIcon from '@/app/letters/remove-from-letterbox-icon'
import ArchiveList from './archive-list'
import WriteQuillButton from './write-quill-button'

// A plain, universally recognized back chevron — never an unfamiliar
// or "branded" symbol invented for this one control. Same stroke-icon
// language as every other icon in this app.
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

/**
 * Letterbox Level 2 — the archive of letters shared with one specific
 * person, gathered across every correspondence episode the viewer
 * hasn't hidden with them (see getLetterArchiveWithUser). Reached only
 * from a Level 1 person card; opens the existing, untouched
 * individual-letter reader (/letters/[letterId]) when a card is
 * clicked.
 *
 * Account deletion deliberately keeps the OTHER participant's letters,
 * and a full block likewise leaves historical letters in Letterbox. In
 * either case public_profiles can no longer resolve the other person.
 * That missing profile must not destroy access to an otherwise-visible
 * archive, and it must not be used to infer WHY the profile vanished.
 * Historical mail therefore renders under a neutral identity while the
 * live profile link and write action disappear. If neither a profile nor
 * any visible correspondence exists, this is simply an invalid archive
 * URL and the segment's not-found state handles it.
 */
export default async function LetterArchiveWithUserPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId: otherUserId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  if (otherUserId === user.id) {
    redirect('/letters')
  }

  const [{ data: profiles }, letters, waitingCount, visibleCorrespondenceIds, incomingInTransit] =
    await Promise.all([
      supabase
        .from('public_profiles')
        .select('id, pseudonym, mark_id')
        .in('id', [user.id, otherUserId]),
      getLetterArchiveWithUser(supabase, user.id, otherUserId),
      getWaitingLetterCount(supabase, user.id),
      getVisibleCorrespondenceIdsWithUser(supabase, user.id, otherUserId),
      getIncomingMailInTransit(supabase),
    ])

  const otherProfile = (profiles ?? []).find((p) => p.id === otherUserId) ?? null
  const hasHistoricalAccess = letters.length > 0 || visibleCorrespondenceIds.length > 0
  if (!otherProfile && !hasHistoricalAccess) {
    notFound()
  }

  const viewerPseudonym = (profiles ?? []).find((p) => p.id === user.id)?.pseudonym ?? 'You'
  const otherPseudonym = otherProfile?.pseudonym ?? 'A Tempa member'
  const otherMarkUrl = otherProfile?.mark_id
    ? publicProfileMarkUrl(supabase, `${otherProfile.mark_id}.png`)
    : null
  // Same existence-only signal Letterbox Level 1 already shows for
  // this person (incomingMailInTransitPersonIds) — scoped to THIS
  // specific correspondent, never "some mail is on the way somewhere."
  // No new query shape, no inspection of the hidden letter itself.
  const mailOnTheWayFromThisPerson = incomingMailInTransitPersonIds(incomingInTransit).has(otherUserId)

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-2xl">
          <Link
            href="/letters"
            aria-label="Back to Pen pals"
            className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-foreground"
          >
            <BackChevronIcon />
            Letterbox
          </Link>
          <div className="mb-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              {otherProfile ? (
                /* Mindform + pseudonym form ONE link while the profile is
                   actually visible. A missing profile is deliberately not
                   replaced by a dead profile link. */
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
          </div>

          <ArchiveList
            letters={letters}
            viewerId={user.id}
            otherUserId={otherUserId}
            otherPseudonym={otherPseudonym}
            viewerPseudonym={viewerPseudonym}
          />
        </div>
      </main>
      {otherProfile && <WriteQuillButton otherUserId={otherProfile.id} otherPseudonym={otherProfile.pseudonym} />}
    </AppShell>
  )
}

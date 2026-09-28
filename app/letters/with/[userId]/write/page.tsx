import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getActiveEstablishedCorrespondenceWithUser,
  getFirstLockedPhotoLetterMoment,
  getMomentsForLetters,
  isEstablishedForViewer,
  isMomentsQualifiedForViewer,
  isPhotoDecisionOutstandingForUser,
  resolveReplyToId,
} from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import { hasAcknowledgedCorrespondenceFeature } from '@/lib/acknowledgements'
import type { Moment } from '@/lib/moments'
import { helperTextClass, secondaryButtonClass, systemHeadingClass } from '@/app/profile/ui'
import MomentsComposer from '@/app/letters/[letterId]/moments-composer'

function BackArrowIcon() {
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
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

/**
 * The permanent Write Anytime composer for an already-established
 * correspondence — reached two ways, both landing here with the SAME
 * underlying composer and the SAME write_letter RPC:
 *   - the person archive's quill (/letters/with/[userId]/write)
 *   - Reply from a specific incoming letter
 *     (/letters/with/[userId]/write?replyTo=[letterId])
 * There is no separate implementation for either path — only whether
 * replyTo is present differs, and that's purely contextual ancestry
 * (see write_letter's p_reply_to_id), never a turn-taking concern.
 *
 * The active, ESTABLISHED correspondence with this person is resolved
 * here, server-side — never trusted from the client, never created if
 * missing, and never a fallback into first-contact composition (that
 * remains the existing Minds -> Write flow at /write/[recipientId]).
 */
export default async function WriteToPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ replyTo?: string }>
}) {
  const { userId: otherUserId } = await params
  const { replyTo } = await searchParams
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

  const [{ data: profiles }, correspondence] = await Promise.all([
    // Letter-Level Postcards V1, pre-migration audit correction
    // (2026-09-14): the composer's own Postcard preview needs the
    // CURRENT member's own pseudonym (never a snapshot — see
    // resolveLetterPostcardDisplay's own doc comment, lib/moments.ts),
    // so both ids are fetched in this one query rather than adding a
    // second round trip.
    supabase.from('public_profiles').select('id, pseudonym').in('id', [user.id, otherUserId]),
    getActiveEstablishedCorrespondenceWithUser(supabase, user.id, otherUserId),
  ])

  const profile = (profiles ?? []).find((p) => p.id === otherUserId) ?? null
  const myPseudonym = (profiles ?? []).find((p) => p.id === user.id)?.pseudonym ?? 'You'

  if (!profile) {
    notFound()
  }

  const cancelHref = `/letters/with/${otherUserId}`

  // correspondence (found above) confirms established_at is set in the
  // DATABASE — a necessary but not sufficient condition. This viewer
  // must also be able to actually SEE the reply that set it: for the
  // party who sent it, that's immediate; for the original Letter-1
  // sender, it isn't true until Mail Call delivers it. Without this
  // second check, that sender would reach a real Write Anytime composer
  // before they legitimately know the correspondence exists. See
  // isEstablishedForViewer's own doc comment (lib/letters.ts).
  const establishedForViewer = correspondence ? await isEstablishedForViewer(supabase, correspondence.id) : false

  if (!correspondence || !establishedForViewer) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className={helperTextClass}>
            You don&apos;t have an established correspondence with {profile.pseudonym} yet.
          </p>
          <Link href={cancelHref} className={secondaryButtonClass}>
            Back to {profile.pseudonym}
          </Link>
        </div>
      </main>
    )
  }

  // A supplied replyTo must genuinely belong to THIS correspondence —
  // defense in depth only (resolveReplyToId); write_letter re-validates
  // this itself, server-side, regardless of what the client sends. Body
  // is fetched in this same round trip (not a second query) so "View
  // [pseudonym]'s letter" (below) can open instantly with the exact
  // source letter this draft is actually replying to — never merely the
  // newest letter in the correspondence, and never re-derived later.
  const { data: replyToLetterRow } = replyTo
    ? await supabase
        .from('letters_for_participant')
        .select('id, correspondence_id, body')
        .eq('id', replyTo)
        .maybeSingle()
    : { data: null }
  const replyToId = resolveReplyToId(
    replyTo,
    replyToLetterRow ? { id: replyToLetterRow.id, correspondenceId: replyToLetterRow.correspondence_id } : null,
    correspondence.id
  )

  const canSendPhoto =
    correspondence.photoConsentStatus === 'no_request' || correspondence.photoConsentStatus === 'enabled'
  const photoDecisionOutstandingForMe = isPhotoDecisionOutstandingForUser(
    {
      status: correspondence.photoConsentStatus,
      requestedBy: correspondence.photoConsentRequestedBy,
      resolvedBy: correspondence.photoConsentResolvedBy,
    },
    user.id
  )

  const [lockedElsewhere, momentsQualified, postcardIntroSeen, firstPhotoNoticeAcknowledged, sourceLetterMomentsById] =
    await Promise.all([
      getFirstLockedPhotoLetterMoment(supabase, correspondence.id),
      // Distinct from establishedForViewer above: Write Anytime access to
      // THIS composer only requires establishment; whether a Moment may
      // actually be attached in it needs Letter 2 to have delivered too.
      // See isMomentsQualifiedForViewer's own doc comment (lib/letters.ts).
      isMomentsQualifiedForViewer(supabase, correspondence.id),
      // Onboarding & First-Use checkpoint (Checkpoint 2B, Section A) — the
      // SAME 'postcard' guide_completions key the Dispatch composer's own
      // Postcard slot uses (app/board/write/page.tsx) — Postcard is one
      // cross-surface feature, taught once on whichever surface a member
      // reaches it first, never a second surface-specific guide key.
      hasCompletedGuide(supabase, user.id, 'postcard'),
      // Repeated-first-photo-explanation fix — durable, per-(member,
      // correspondence) state (correspondence_feature_acknowledgements,
      // the SAME table/primitive 'moments_available' already uses),
      // never client-side-only memory: this is what makes "already
      // continued past the explanation" survive closing/reopening the
      // composer, a refresh, or signing out and back in. Read here
      // regardless of the CURRENT photoConsentStatus — a member who has
      // already continued once must not see it again even if they
      // haven't sent a photo yet (see isFirstPhotoRequest below).
      hasAcknowledgedCorrespondenceFeature(supabase, user.id, correspondence.id, 'first_photo_notice'),
      replyToId ? getMomentsForLetters(supabase, [replyToId]) : Promise.resolve(new Map<string, Moment[]>()),
    ])
  const reviewPhotoHref = lockedElsewhere
    ? `/letters/${lockedElsewhere.letterId}#locked-photo-${lockedElsewhere.momentId}`
    : undefined

  // The first-photo explanation is correspondence-scoped, not photo-
  // scoped: once this member has continued past it once for this
  // correspondence (whether in an earlier session or earlier in this
  // same draft), every later photo attaches immediately — see
  // moments-composer.tsx's own confirmFirstPhoto, which is what writes
  // this acknowledgement the first time.
  const isFirstPhotoRequest = correspondence.photoConsentStatus === 'no_request' && !firstPhotoNoticeAcknowledged

  // "View [pseudonym]'s letter" — the exact source letter this draft is
  // replying to, already fetched above; never fabricated when there is
  // none (a fresh, non-reply Write Anytime letter has no source letter
  // at all, and the composer simply omits the control).
  const sourceLetter = replyToId
    ? {
        id: replyToId,
        body: replyToLetterRow?.body ?? '',
        moments: sourceLetterMomentsById.get(replyToId) ?? [],
        photoConsent: {
          correspondenceId: correspondence.id,
          status: correspondence.photoConsentStatus,
          requestedBy: correspondence.photoConsentRequestedBy,
          resolvedBy: correspondence.photoConsentResolvedBy,
          userId: user.id,
          otherPseudonym: profile.pseudonym,
        },
      }
    : null

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 sm:px-6">
        <Link
          href={cancelHref}
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          <BackArrowIcon />
          Back
        </Link>
        <p className={`truncate ${systemHeadingClass} text-[16px]`}>Writing to {profile.pseudonym}</p>
        <span className="w-[52px]" aria-hidden="true" />
      </div>

      <div className="flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <MomentsComposer
            correspondenceId={correspondence.id}
            replyToId={replyToId}
            momentsQualified={momentsQualified}
            canSendPhoto={canSendPhoto}
            isFirstPhotoRequest={isFirstPhotoRequest}
            photoDecisionOutstandingForMe={photoDecisionOutstandingForMe}
            reviewPhotoHref={reviewPhotoHref}
            recipientPseudonym={profile.pseudonym}
            senderPseudonym={myPseudonym}
            cancelHref={cancelHref}
            showPostcardIntro={!postcardIntroSeen}
            viewerId={user.id}
            sourceLetter={sourceLetter}
          />
        </div>
      </div>
    </div>
  )
}

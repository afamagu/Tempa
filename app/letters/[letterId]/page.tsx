import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetterById,
  getMomentsForLetters,
  getLetterPostcardsForLetters,
  letterPostcardToBaseContent,
  getFirstLockedPhotoLetterMoment,
  isEffectivelyExpired,
  isEstablishedForViewer,
  isMomentsQualifiedForViewer,
  getWaitingLetterCount,
  getCorrespondence,
  resolveLetterDirection,
  resolveLetterActionState,
  shouldMarkLetterOpened,
} from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import { getBlockScope } from '@/lib/blocking'
import { hasAcknowledgedCorrespondenceFeature } from '@/lib/acknowledgements'
import { formatDateTimeFull } from '@/lib/format-date'
import { metadataTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import MarkLetterOpened from './mark-opened'
import PhotoConsent from './photo-consent'
import MomentsWalkthroughGate from './moments-walkthrough-gate'
import MomentsAvailableNotice from './moments-available-notice'
import LetterActionMenu from './letter-action-menu'
import LetterBody from './letter-body'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import FirstContactResponse from './first-contact-response'
import ClosureStatusNotice from './closure-status-notice'
import ClosureRecommendations from '@/app/letters/closure-recommendations'
import WriteQuillButton from '@/app/letters/with/[userId]/write-quill-button'

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
 * The individual-letter reader — one opened letter, never the whole
 * correspondence rendered underneath it (the giant thread presentation
 * is retired). Reached from a Level 2 archive card
 * (/letters/with/[otherUserId]); back navigation returns there, never
 * to a generic thread.
 *
 * There is no per-letter "Reply" anymore — once a correspondence is
 * established, the SAME persistent floating quill used on the person
 * archive is the one way to write, regardless of which letter is open
 * or who sent it (see resolveLetterActionState, lib/letters.ts). It
 * links to the plain composer route with no ?replyTo — write_letter
 * still fully supports p_reply_to_id (nothing about that capability
 * was removed), there is simply no UI here driving it right now. The
 * one exception is the un-replied first-contact letter itself, still
 * governed by the old special establishment rules
 * (FirstContactResponse below) — that reply is what SETS
 * established_at, so it can never go through the quill/write_letter.
 */
export default async function LetterPage({
  params,
}: {
  params: Promise<{ letterId: string }>
}) {
  const { letterId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Arrival emails link to this exact letter. Keep the destination through
    // sign-in; the existing sign-in flow validates `next` before using it.
    redirect(`/sign-in?next=${encodeURIComponent(`/letters/${letterId}`)}`)
  }

  const target = await getLetterById(supabase, letterId)

  if (!target || (target.senderId !== user.id && target.recipientId !== user.id)) {
    redirect('/letters')
  }

  const isRecipientOfTarget = target.recipientId === user.id
  const otherPartyId = isRecipientOfTarget ? target.senderId : target.recipientId

  const [
    { data: profiles },
    correspondence,
    establishedForViewer,
    momentsQualified,
    guideCompleted,
    momentsNoticeAcknowledged,
    waitingCount,
    momentsByLetterId,
    letterPostcardsByLetterId,
    lockedElsewhere,
    otherPartyBlockScope,
  ] = await Promise.all([
    supabase.from('public_profiles').select('id, pseudonym, mark_id').in('id', [user.id, otherPartyId]),
    getCorrespondence(supabase, target.correspondenceId),
    isEstablishedForViewer(supabase, target.correspondenceId),
    isMomentsQualifiedForViewer(supabase, target.correspondenceId),
    hasCompletedGuide(supabase, user.id, 'moments'),
    hasAcknowledgedCorrespondenceFeature(supabase, user.id, target.correspondenceId, 'moments_available'),
    getWaitingLetterCount(supabase, user.id),
    getMomentsForLetters(supabase, [target.id]),
    getLetterPostcardsForLetters(supabase, [target.id]),
    getFirstLockedPhotoLetterMoment(supabase, target.correspondenceId),
    getBlockScope(supabase, otherPartyId),
  ])
  const letterPostcard = letterPostcardsByLetterId.get(target.id) ?? null

  const pseudonymById = new Map((profiles ?? []).map((p) => [p.id, p.pseudonym]))
  const markUrlById = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.mark_id ? publicProfileMarkUrl(supabase, `${p.mark_id}.png`) : null,
    ])
  )
  const otherPseudonym = pseudonymById.get(otherPartyId) ?? 'A member'

  // Correspondence-level context (the originating Question) — only
  // ever set on the root first-contact letter, so this naturally only
  // renders when target IS that letter.
  let context: string | null = null
  if (target.questionAnswerId) {
    const { data: answerRow } = await supabase
      .from('question_answers')
      .select('questions(prompt)')
      .eq('id', target.questionAnswerId)
      .maybeSingle()
    const question = answerRow
      ? Array.isArray(answerRow.questions)
        ? answerRow.questions[0]
        : answerRow.questions
      : null
    context = question?.prompt ?? null
  }

  const { senderName, recipientName } = resolveLetterDirection(target, pseudonymById)
  const senderProfileHref = target.senderId === user.id ? null : `/minds/${target.senderId}`

  // The raw DB-level fact — established_at set at all, regardless of
  // who sent the reply that set it or whether this viewer can see it
  // yet. Still correct for isEffectivelyExpired below: a surviving
  // crossed-direction root's own decay suppression is about the
  // correspondence's lifecycle (has it moved past the strict
  // first-contact regime at all), not about what THIS viewer has been
  // shown — that letter is already unconditionally visible to both
  // participants regardless (see target's own fetch via
  // letters_for_participant), so there is no confidentiality concern
  // here to fix.
  const established = correspondence?.establishedAt != null

  // established must gate expiry BEFORE anything else derives from it —
  // an established correspondence's ordinary letters (reply_to_id=null
  // for a quill-sent one included) must never be treated as an expired,
  // unaccepted first contact merely because 72 hours passed. See
  // isEffectivelyExpired's own doc comment.
  const targetExpired = isEffectivelyExpired(target, established)
  const targetEffectiveStatus = targetExpired ? 'closed' : target.status
  const targetEffectiveClosedBy = targetExpired ? 'system' : target.closedBy

  const isFirstContactLetter = target.replyToId === null

  // Everything below actually DISCLOSES establishment to this viewer
  // (Moments, PhotoConsent, the Write Anytime quill, and the
  // first-contact response UI's own suppression) — unlike
  // isEffectivelyExpired above, these must use establishedForViewer,
  // not the raw DB fact, or the original Letter-1 sender learns Letter
  // 2 exists before it's actually delivered to them. See
  // isEstablishedForViewer's own doc comment (lib/letters.ts).
  //
  // The single source of truth for which action surface renders — see
  // resolveLetterActionState's own doc comment for why this is one
  // function rather than two independently-computed booleans.
  const { showFirstContactResponse, showWriteQuill } = resolveLetterActionState(
    establishedForViewer,
    isFirstContactLetter,
    isRecipientOfTarget,
    targetEffectiveStatus
  )
  const writeHref = establishedForViewer ? `/letters/with/${otherPartyId}/write` : null

  // Letter 1/2 stay text-only; Letter 3 onward carries Moments — but
  // ONLY once Letter 2 has actually delivered (deliver_at <= now()),
  // for BOTH participants, not merely established_at being set.
  // establishedForViewer is the Write Anytime signal (the Letter-2
  // sender is entitled to keep writing immediately); momentsQualified
  // (isMomentsQualifiedForViewer, fetched above) is the stricter,
  // separate signal those subsequent letters need before they may
  // carry a Moment. See that function's own doc comment (lib/letters.ts).

  const showWalkthrough = momentsQualified && !guideCompleted && writeHref !== null
  const showMomentsNotice = momentsQualified && guideCompleted && !momentsNoticeAcknowledged && writeHref !== null

  const reviewPhotoHref = lockedElsewhere
    ? `/letters/${lockedElsewhere.letterId}#locked-photo-${lockedElsewhere.momentId}`
    : undefined

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      {showWalkthrough && writeHref && (
        <MomentsWalkthroughGate
          correspondenceId={target.correspondenceId}
          otherPseudonym={otherPseudonym}
          composeHref={writeHref}
        />
      )}

      {shouldMarkLetterOpened(target, user.id) && <MarkLetterOpened letterId={target.id} />}

      <div className="min-h-screen bg-surface-shell">
        <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
          <Link
            href={`/letters/with/${otherPartyId}`}
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            <BackArrowIcon />
            {otherPseudonym}
          </Link>

          {context && (
            <p className={`mt-4 line-clamp-2 ${metadataTextClass}`}>
              Started from: &ldquo;{context}&rdquo;
            </p>
          )}

          {showMomentsNotice && writeHref && (
            <MomentsAvailableNotice
              correspondenceId={target.correspondenceId}
              otherPseudonym={otherPseudonym}
              composeHref={writeHref}
            />
          )}

          {momentsQualified && correspondence && (
            <div className="mt-4 rounded-md border border-foreground/10 px-4 py-3">
              <PhotoConsent
                correspondenceId={correspondence.id}
                status={correspondence.photoConsentStatus}
                requestedBy={correspondence.photoConsentRequestedBy}
                resolvedBy={correspondence.photoConsentResolvedBy}
                userId={user.id}
                otherPseudonym={otherPseudonym}
                reviewPhotoHref={reviewPhotoHref}
              />
            </div>
          )}

          {/* Release Polish Pass — the closure status now reads as quiet
              correspondence METADATA (ClosureStatusNotice: narrow clay
              accent rule + envelope glyph), deliberately given its own
              separation from PhotoConsent above and the historical
              letter below, rather than sharing one homogeneous bordered
              box with either. */}
          {targetEffectiveStatus === 'closed' && (
            <div className="mt-4">
              {targetEffectiveClosedBy === 'recipient' ? (
                <ClosureStatusNotice
                  title={isRecipientOfTarget ? 'You passed on this letter.' : `${otherPseudonym} passed on this letter.`}
                  detail={target.closeReason ?? ''}
                />
              ) : (
                <ClosureStatusNotice
                  title="This letter went unanswered"
                  detail={
                    isRecipientOfTarget
                      ? "You weren't able to reply within the reply window."
                      : `${otherPseudonym} wasn't able to reply within the reply window.`
                  }
                />
              )}
            </div>
          )}

          <div className="mt-6 rounded-md bg-background p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              {senderProfileHref ? (
                <Link href={senderProfileHref} className="flex min-w-0 items-center gap-3 hover:opacity-80">
                  <ProfileIdentityMark
                    identifier={target.senderId}
                    markUrl={markUrlById.get(target.senderId) ?? null}
                    label={markUrlById.get(target.senderId) ? `${senderName}'s Mark` : undefined}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-foreground">{senderName}</p>
                    <p className={`truncate ${metadataTextClass}`}>to {recipientName}</p>
                  </div>
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileIdentityMark
                    identifier={target.senderId}
                    markUrl={markUrlById.get(target.senderId) ?? null}
                    label={markUrlById.get(target.senderId) ? `${senderName}'s Mark` : undefined}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-foreground">{senderName}</p>
                    <p className={`truncate ${metadataTextClass}`}>to {recipientName}</p>
                  </div>
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1">
                <span className={`${metadataTextClass} whitespace-nowrap`}>
                  {formatDateTimeFull(target.createdAt)}
                </span>
                <LetterActionMenu
                  letterId={target.id}
                  correspondenceId={target.correspondenceId}
                  otherPartyId={otherPartyId}
                  otherPseudonym={otherPseudonym}
                  initialBlockScope={otherPartyBlockScope}
                />
              </div>
            </div>

            {/* Letter-Level Postcards V1 (2026-09-13) — the same
                canonical letterhead enclosure slot Preview uses,
                positioned above the body, never inline with it. A
                historical inline Postcard Moment (type='postcard')
                needs no slot at all — it renders exactly where it always
                has, inside LetterBody below. */}
            {letterPostcard && (
              <div className="mt-4">
                <LetterheadPostcard
                  // Admin Phase 2A-2 — the frozen presentation identity
                  // that actually shipped with this letter (title,
                  // location, collection, postmark/footer text, and
                  // artwork), never whatever the catalogue's CURRENT
                  // entry for the same key defines today.
                  base={letterPostcardToBaseContent(letterPostcard.version)}
                  revealLine={letterPostcard.revealLine}
                  backMessage={letterPostcard.backMessage}
                  // Final pre-migration architecture correction
                  // (2026-09-14) — the FROZEN signature from send time,
                  // never the live-resolved senderName used for the
                  // letter header just above (which intentionally stays
                  // dynamic). A sent Postcard's own back must never
                  // silently rewrite itself if the sender later renames.
                  senderPseudonym={letterPostcard.senderPseudonymSnapshot}
                />
              </div>
            )}

            <div className="mt-4 max-w-[68ch]">
              <LetterBody
                body={target.body}
                moments={momentsByLetterId.get(target.id) ?? []}
                photoConsent={
                  correspondence
                    ? {
                        correspondenceId: correspondence.id,
                        status: correspondence.photoConsentStatus,
                        requestedBy: correspondence.photoConsentRequestedBy,
                        resolvedBy: correspondence.photoConsentResolvedBy,
                        userId: user.id,
                        otherPseudonym,
                      }
                    : undefined
                }
              />
            </div>
          </div>

          <div className="mt-6">
            {showFirstContactResponse && (
              <FirstContactResponse
                letterId={target.id}
                correspondenceId={target.correspondenceId}
                recipientPseudonym={otherPseudonym}
              />
            )}

            {isFirstContactLetter && targetEffectiveStatus === 'sent' && !isRecipientOfTarget && (
              <p className={metadataTextClass}>Waiting for a reply.</p>
            )}
          </div>

          {targetEffectiveStatus === 'closed' && isFirstContactLetter && !isRecipientOfTarget && (
            <div className="mt-6">
              <ClosureRecommendations letterId={target.id} />
            </div>
          )}

          {/* Bottom-of-letter return nav (pre-beta UX polish batch 1) —
              the same destination/context as the top back link, so a
              reader who reaches the end of a very long letter never has
              to scroll back up just to return to the correspondence.
              Deliberately an ordinary in-flow link, not sticky/floating. */}
          <div className="mt-10 border-t border-foreground/10 pt-4">
            <Link
              href={`/letters/with/${otherPartyId}`}
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
            >
              <BackArrowIcon />
              Back to {otherPseudonym}
            </Link>
          </div>
        </main>
      </div>

      {showWriteQuill && <WriteQuillButton otherUserId={otherPartyId} otherPseudonym={otherPseudonym} />}
    </AppShell>
  )
}

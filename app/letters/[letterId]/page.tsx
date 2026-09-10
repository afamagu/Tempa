import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetterById,
  getMomentsForLetters,
  getLetterPostcardsForLetters,
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
import { metadataTextClass, closureTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import Mindform from '@/app/mindform'
import MarkLetterOpened from './mark-opened'
import PhotoConsent from './photo-consent'
import MomentsWalkthroughGate from './moments-walkthrough-gate'
import MomentsAvailableNotice from './moments-available-notice'
import LetterActionMenu from './letter-action-menu'
import LetterBody from './letter-body'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import FirstContactResponse from './first-contact-response'
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
    redirect('/sign-in')
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
    supabase.from('public_profiles').select('id, pseudonym').in('id', [user.id, otherPartyId]),
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

          {(momentsQualified || targetEffectiveStatus === 'closed') && (
            <div className="mt-4 space-y-3 rounded-md border border-foreground/10 px-4 py-3">
              {momentsQualified && correspondence && (
                <PhotoConsent
                  correspondenceId={correspondence.id}
                  status={correspondence.photoConsentStatus}
                  requestedBy={correspondence.photoConsentRequestedBy}
                  resolvedBy={correspondence.photoConsentResolvedBy}
                  userId={user.id}
                  otherPseudonym={otherPseudonym}
                  reviewPhotoHref={reviewPhotoHref}
                />
              )}

              {targetEffectiveStatus === 'closed' &&
                (targetEffectiveClosedBy === 'recipient' ? (
                  <>
                    <p className={closureTextClass}>
                      {isRecipientOfTarget
                        ? 'You passed on this letter.'
                        : `${otherPseudonym} passed on this letter.`}
                    </p>
                    <p className={closureTextClass}>{target.closeReason}</p>
                  </>
                ) : (
                  <>
                    <p className={closureTextClass}>This letter went unanswered.</p>
                    <p className={closureTextClass}>
                      Its recipient wasn&apos;t able to respond within the reply window.
                    </p>
                  </>
                ))}
            </div>
          )}

          <div className="mt-6 rounded-md bg-background p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              {senderProfileHref ? (
                <Link href={senderProfileHref} className="flex min-w-0 items-center gap-3 hover:opacity-80">
                  <Mindform identifier={target.senderId} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-foreground">{senderName}</p>
                    <p className={`truncate ${metadataTextClass}`}>to {recipientName}</p>
                  </div>
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-3">
                  <Mindform identifier={target.senderId} size="md" />
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
                  postcardKey={letterPostcard.postcardKey}
                  revealLine={letterPostcard.revealLine}
                  backMessage={letterPostcard.backMessage}
                  // Final pre-migration architecture correction
                  // (2026-09-14) — the FROZEN signature from send time,
                  // never the live-resolved senderName used for the
                  // letter header just above (which intentionally stays
                  // dynamic). A sent Postcard's own back must never
                  // silently rewrite itself if the sender later renames.
                  senderPseudonym={letterPostcard.senderPseudonymSnapshot}
                  // Thumbnail + expanded-experience checkpoint
                  // (2026-09-14), Part 9 — the frozen asset identity
                  // that actually shipped with this letter, never
                  // whatever POSTCARD_CATALOG's current entry defines.
                  version={letterPostcard.version}
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

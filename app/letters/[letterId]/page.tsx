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
  quillReplyToId,
  resolveLetterActionState,
  shouldMarkLetterOpened,
  closeReasonForSender,
} from '@/lib/letters'
import { getReturnCardPostcards, isReturnCardAvailable } from '@/lib/return-cards'
import { hasCompletedGuide } from '@/lib/guide'
import { getLetterWritingStyles } from '@/lib/writing-style-data'
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
import LetterReader from './letter-reader'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import FirstContactResponse from './first-contact-response'
import ClosureStatusNotice from './closure-status-notice'
import ContactSharingNote from './contact-sharing-note'
import ClosureRecommendations from '@/app/letters/closure-recommendations'
import WriteQuillButton from '@/app/letters/with/[userId]/write-quill-button'
import ReturnCardAction from './return-card-action'

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
 * One individual letter, never a thread. The pending first-contact reply
 * remains the only relationship-establishing action; established mail uses
 * the persistent quill. Phase 7 adds a separate Return Card affordance for
 * an overdue incoming letter without changing either letter path.
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
    { data: contactNote },
    { data: onBreakIds },
    letterWritingStyles,
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
    isRecipientOfTarget
      ? supabase.from('letter_safety_notices').select('kind').eq('letter_id', target.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.rpc('correspondents_on_break', { p_user_ids: [otherPartyId] }),
    getLetterWritingStyles(supabase, [target.id]),
  ])

  const letterWritingStyleId = letterWritingStyles.get(target.id) ?? null
  const otherIsOnBreak = Array.isArray(onBreakIds) && (onBreakIds as unknown[]).length > 0
  const letterPostcard = letterPostcardsByLetterId.get(target.id) ?? null

  const returnCardAvailable =
    establishedForViewer && isRecipientOfTarget && !otherIsOnBreak
      ? await isReturnCardAvailable(supabase, target.id)
      : false
  const returnCardPostcards = returnCardAvailable
    ? await getReturnCardPostcards(supabase)
    : []

  const pseudonymById = new Map((profiles ?? []).map((p) => [p.id, p.pseudonym]))
  const markUrlById = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.mark_id ? publicProfileMarkUrl(supabase, `${p.mark_id}.png`) : null,
    ])
  )
  const otherPseudonym = pseudonymById.get(otherPartyId) ?? 'A member'

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

  const { data: memberQuestionContext } = await supabase
    .from('member_question_letter_contexts')
    .select('prompt_snapshot')
    .eq('letter_id', target.id)
    .maybeSingle()
  if (memberQuestionContext) context = memberQuestionContext.prompt_snapshot

  const { senderName, recipientName } = resolveLetterDirection(target, pseudonymById)
  const senderProfileHref = target.senderId === user.id ? null : `/minds/${target.senderId}`

  const established = correspondence?.establishedAt != null
  const targetExpired = isEffectivelyExpired(target, established)
  const targetEffectiveStatus = targetExpired ? 'closed' : target.status
  const targetEffectiveClosedBy = targetExpired ? 'system' : target.closedBy
  const isFirstContactLetter = target.replyToId === null

  const writingAvailable = establishedForViewer && correspondence?.status === 'active'
  const { showFirstContactResponse, showWriteQuill } = resolveLetterActionState(
    writingAvailable,
    isFirstContactLetter,
    isRecipientOfTarget,
    targetEffectiveStatus
  )
  const writeHref = writingAvailable ? `/letters/with/${otherPartyId}/write` : null

  const targetPhotoConsent = correspondence
    ? {
        correspondenceId: correspondence.id,
        status: correspondence.photoConsentStatus,
        requestedBy: correspondence.photoConsentRequestedBy,
        resolvedBy: correspondence.photoConsentResolvedBy,
        userId: user.id,
        otherPseudonym,
      }
    : undefined

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

          {otherIsOnBreak && (
            <p className={`mt-3 ${metadataTextClass}`}>{otherPseudonym} is taking a break from Tempa.</p>
          )}

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

          {targetEffectiveStatus === 'closed' && (
            <div className="mt-4">
              {targetEffectiveClosedBy === 'recipient' ? (
                <ClosureStatusNotice
                  title={isRecipientOfTarget ? 'You passed on this letter.' : `${otherPseudonym} passed on this letter.`}
                  detail={closeReasonForSender(target.closeReason)}
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

            {letterPostcard && (
              <div className="mt-4">
                <LetterheadPostcard
                  base={letterPostcardToBaseContent(letterPostcard.version)}
                  revealLine={letterPostcard.revealLine}
                  backMessage={letterPostcard.backMessage}
                  senderPseudonym={letterPostcard.senderPseudonymSnapshot}
                />
              </div>
            )}

            <div className="mt-4">
              <LetterReader
                viewerId={user.id}
                letterId={target.id}
                body={target.body}
                moments={momentsByLetterId.get(target.id) ?? []}
                photoConsent={targetPhotoConsent}
                writingStyleId={letterWritingStyleId}
              />
            </div>

            {isRecipientOfTarget && contactNote?.kind === 'contact_sharing' && (
              <ContactSharingNote className="mt-6 max-w-[68ch]" />
            )}
          </div>

          <div className="mt-6">
            {showFirstContactResponse && (
              <FirstContactResponse
                letterId={target.id}
                correspondenceId={target.correspondenceId}
                recipientPseudonym={otherPseudonym}
                viewerId={user.id}
                sourceLetterBody={target.body}
                sourceLetterMoments={momentsByLetterId.get(target.id) ?? []}
                sourceLetterPhotoConsent={targetPhotoConsent}
                sourceLetterWritingStyleId={letterWritingStyleId}
              />
            )}

            {isFirstContactLetter && targetEffectiveStatus === 'sent' && !isRecipientOfTarget && (
              <p className={metadataTextClass}>Waiting for a reply.</p>
            )}
          </div>

          {returnCardAvailable && returnCardPostcards.length > 0 && (
            <ReturnCardAction
              sourceLetterId={target.id}
              postcards={returnCardPostcards}
              otherPseudonym={otherPseudonym}
            />
          )}

          {targetEffectiveStatus === 'closed' && isFirstContactLetter && !isRecipientOfTarget && (
            <div className="mt-6">
              <ClosureRecommendations letterId={target.id} />
            </div>
          )}

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

      {showWriteQuill && (
        <WriteQuillButton
          otherUserId={otherPartyId}
          otherPseudonym={otherPseudonym}
          replyToId={quillReplyToId(target, user.id)}
        />
      )}
    </AppShell>
  )
}

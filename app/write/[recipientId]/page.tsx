import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { introductionReturnPath } from '@/lib/introduction-navigation'
import { getCorrespondenceLifecycleWithMember } from '@/lib/correspondence-lifecycle'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getActiveEstablishedCorrespondenceWithUser,
  closeReasonForSender,
  getFirstContact,
  getFirstContactAttempts,
  deriveFirstContactAttemptState,
  isReplyableFirstContact,
  isEstablishedForViewer,
  resolveFirstContactDisplayStatus,
} from '@/lib/letters'
import {
  getRelationshipCapacity,
  newCorrespondenceUnavailableMessage,
} from '@/lib/relationship-capacity'
import {
  sectionLabelClass,
  helperTextClass,
  secondaryButtonClass,
  closureTextClass,
  quietLinkClass,
} from '@/app/profile/ui'
import FirstLetterComposer from './first-letter-composer'
import ClosureRecommendations from '@/app/letters/closure-recommendations'

export default async function WriteToPage({
  params,
  searchParams,
}: {
  params: Promise<{ recipientId: string }>
  searchParams: Promise<{ a?: string; source?: string; returnTo?: string; mq?: string; d?: string; followUp?: string }>
}) {
  const { recipientId } = await params
  const { a: answerId, source, returnTo, mq, d: dispatchId, followUp } = await searchParams
  const backHref = introductionReturnPath(returnTo) ?? '/room'
  const nav = await getTranslations('Nav')
  const letters = await getTranslations('Letters')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const query = new URLSearchParams()
    if (answerId) query.set('a', answerId)
    if (source) query.set('source', source)
    if (mq) query.set('mq', mq)
    if (dispatchId) query.set('d', dispatchId)
    if (followUp) query.set('followUp', followUp)
    if (backHref !== '/room') query.set('returnTo', backHref)
    redirect(`/sign-in?next=${encodeURIComponent(`/write/${recipientId}${query.size ? `?${query}` : ''}`)}`)
  }

  if (recipientId === user.id) redirect('/room')

  const { data: recipient } = await supabase
    .from('public_profiles')
    .select('pseudonym')
    .eq('id', recipientId)
    .maybeSingle()

  if (!recipient) redirect('/room')

  const { data: memberQuestion } = mq ? await supabase.from('member_questions').select('id, body').eq('id', mq).eq('author_id', recipientId).eq('is_profile_visible', true).eq('moderation_status', 'visible').is('withdrawn_at', null).maybeSingle() : { data: null }
  if (mq && !memberQuestion) redirect(backHref)

  const { data: dispatchContext } =
    source === 'dispatch' && dispatchId
      ? await supabase
          .from('dispatches')
          .select('id, title, author_id, status, moderation_status, published_as')
          .eq('id', dispatchId)
          .eq('author_id', recipientId)
          .eq('status', 'published')
          .eq('moderation_status', 'visible')
          .maybeSingle()
      : { data: null }

  if (source === 'dispatch' && (!dispatchId || !dispatchContext || (dispatchContext.published_as ?? 'member') !== 'member')) {
    redirect('/board')
  }

  const lifecycle = await getCorrespondenceLifecycleWithMember(supabase, recipientId)

  // Public Room reading remains open to existing correspondents. If this
  // relationship is paused, a private-reply attempt returns to the same
  // preserved correspondence where Pause/Resume controls live; it must never
  // fall through into first-contact logic or create a second episode.
  if (lifecycle?.status === 'paused' && lifecycle.establishedAt) {
    redirect(`/letters/with/${recipientId}`)
  }

  // Phase 6 lifecycle completion: a crossed pair of first letters can leave
  // one historical root status='sent' after the reciprocal reply establishes
  // the SHARED correspondence. The correspondence is authoritative. Once this
  // viewer can actually see that reply through Mail Call, /write must continue
  // into Write Anytime before inspecting either old root; otherwise the stale
  // root can falsely render "waiting for a reply" inside an already-established
  // relationship. The visibility check preserves the existing Mail Call gate:
  // the original sender still cannot enter Write Anytime before the reply is
  // delivered to them.
  const establishedCorrespondence = await getActiveEstablishedCorrespondenceWithUser(
    supabase,
    user.id,
    recipientId
  )
  const establishedForViewer = establishedCorrespondence
    ? await isEstablishedForViewer(supabase, establishedCorrespondence.id)
    : false

  if (establishedCorrespondence && establishedForViewer) {
    const query = new URLSearchParams()
    if (mq) query.set('mq', mq)
    if (mq || backHref !== '/room') query.set('returnTo', backHref)
    redirect(`/letters/with/${recipientId}/write${query.size ? `?${query}` : ''}`)
  }

  // A private relationship has only one first-contact episode at a time.
  // If this person has already written to the viewer, every generic /write
  // entry point should continue through that incoming letter rather than
  // manufacture a crossed pair of first letters.
  const incoming = await getFirstContact(supabase, recipientId, user.id)
  if (incoming && isReplyableFirstContact(incoming, false)) {
    redirect(`/letters/${incoming.id}`)
  }

  const attempts = await getFirstContactAttempts(supabase, user.id, recipientId)
  const attemptState = deriveFirstContactAttemptState(attempts)
  const existing = attemptState.latest

  if (existing) {
    const establishedForExistingViewer =
      existing.status === 'replied'
        ? await isEstablishedForViewer(supabase, existing.correspondenceId)
        : false
    const effectiveStatus = resolveFirstContactDisplayStatus(existing.status, establishedForExistingViewer)

    if (followUp === '1' && attemptState.canFollowUp && existing.questionAnswerId) {
      const [{ data: originalAnswer }, capacity] = await Promise.all([
        supabase
          .from('question_answers')
          .select('id, user_id, questions(prompt)')
          .eq('id', existing.questionAnswerId)
          .eq('user_id', recipientId)
          .maybeSingle(),
        getRelationshipCapacity(supabase),
      ])

      const capacityMessage = newCorrespondenceUnavailableMessage(capacity)
      if (capacityMessage) {
        return (
          <main className="min-h-screen flex items-center justify-center p-6">
            <div className="w-full max-w-md space-y-5 py-10 text-center">
              <p className={sectionLabelClass}>One follow-up</p>
              <p className={helperTextClass}>{capacityMessage}</p>
              <Link href={`/letters/with/${recipientId}`} className={secondaryButtonClass}>
                Back to {recipient.pseudonym}
              </Link>
            </div>
          </main>
        )
      }

      if (originalAnswer) {
        const originalQuestion = Array.isArray(originalAnswer.questions)
          ? originalAnswer.questions[0]
          : originalAnswer.questions

        return (
          <FirstLetterComposer
            key={`${recipientId}:follow-up`}
            recipientId={recipientId}
            recipientPseudonym={recipient.pseudonym}
            questionAnswerId={existing.questionAnswerId}
            questionPrompt={originalQuestion?.prompt ?? null}
            backHref={`/letters/with/${recipientId}`}
            backLabel={recipient.pseudonym}
            isFollowUp
          />
        )
      }
    }

    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 py-10 text-center">
          <p className={sectionLabelClass}>{recipient.pseudonym}</p>

          {effectiveStatus === 'sent' && (
            <p className={helperTextClass}>
              {attemptState.followUpUsed
                ? `Your follow-up to ${recipient.pseudonym} is waiting for a reply.`
                : `You’ve written to ${recipient.pseudonym}. Your letter is waiting for a reply.`}
            </p>
          )}

          {effectiveStatus === 'replied' && (
            <p className={helperTextClass}>{recipient.pseudonym} replied to your letter.</p>
          )}

          {attemptState.recipientPassed && (
            <div className="space-y-2">
              <p className={closureTextClass}>{recipient.pseudonym} passed on this letter.</p>
              <p className={closureTextClass}>{closeReasonForSender(existing.closeReason)}</p>
            </div>
          )}

          {!attemptState.recipientPassed && attemptState.canFollowUp && (
            <div className="space-y-3 rounded-lg border border-foreground/10 p-4 text-left">
              <p className="text-[15px] text-foreground">One follow-up is available.</p>
              <p className={helperTextClass}>
                Tempa keeps first contact quiet. After seven days, you may send one final follow-up.
                If there’s still no reply, the next move is theirs.
              </p>
              <Link href={`/write/${recipientId}?followUp=1`} className={secondaryButtonClass}>
                Write one follow-up
              </Link>
            </div>
          )}

          {!attemptState.recipientPassed &&
            !attemptState.canFollowUp &&
            !attemptState.followUpUsed &&
            effectiveStatus !== 'replied' && (
              <p className={helperTextClass}>
                Tempa allows one follow-up after seven days. Until then, this stays quiet.
              </p>
            )}

          {!attemptState.recipientPassed && attemptState.followUpUsed && effectiveStatus !== 'replied' && (
            <div className="space-y-2">
              <p className={closureTextClass}>You’ve used your one follow-up.</p>
              <p className={helperTextClass}>
                You won’t be able to write again unless {recipient.pseudonym} replies.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/letters" className={secondaryButtonClass}>Your letters</Link>
            <Link href={`/room/${recipientId}`} className={quietLinkClass}>
              Back to {recipient.pseudonym}&apos;s profile
            </Link>
          </div>

          {effectiveStatus === 'closed' && !attemptState.canFollowUp && (
            <div className="text-left">
              <ClosureRecommendations letterId={existing.id} />
            </div>
          )}
        </div>
      </main>
    )
  }

  // A first contact must originate from something the recipient actually wrote.
  // The Room is now the canonical place to recover that context.
  if (!answerId) redirect('/room')

  const [{ data: answer }, capacity] = await Promise.all([
    supabase
      .from('question_answers')
      .select('id, user_id, questions(prompt)')
      .eq('id', answerId)
      .eq('user_id', recipientId)
      .maybeSingle(),
    getRelationshipCapacity(supabase),
  ])

  if (!answer) redirect('/room')

  const capacityMessage = newCorrespondenceUnavailableMessage(capacity)
  const backLabel =
    backHref === '/home'
      ? nav('home')
      : backHref.startsWith('/letters/discover')
        ? letters('discover')
        : backHref.startsWith('/room/')
          ? recipient.pseudonym
          : backHref.startsWith('/board/')
            ? 'the Dispatch'
            : nav('room')
  if (capacityMessage) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-5 py-10 text-center">
          <p className={sectionLabelClass}>Room for someone new</p>
          <p className={helperTextClass}>{capacityMessage}</p>
          <p className={helperTextClass}>
            You can still read {recipient.pseudonym}&apos;s profile and public writing.
          </p>
          <Link href={backHref} className={secondaryButtonClass}>
            Back to {backLabel}
          </Link>
        </div>
      </main>
    )
  }

  const question = Array.isArray(answer.questions) ? answer.questions[0] : answer.questions

  return (
    <FirstLetterComposer
      key={memberQuestion?.id ?? recipientId}
      recipientId={recipientId}
      recipientPseudonym={recipient.pseudonym}
      questionAnswerId={answer.id}
      questionPrompt={memberQuestion?.body ?? question?.prompt ?? null}
      memberQuestionId={memberQuestion?.id}
      backHref={backHref}
      backLabel={backLabel}
      dispatchId={dispatchContext?.id}
      dispatchTitle={dispatchContext?.title}
    />
  )
}

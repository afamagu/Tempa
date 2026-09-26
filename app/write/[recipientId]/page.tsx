import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { closeReasonForSender, getFirstContact, isEffectivelyExpired, isEstablishedForViewer, resolveFirstContactDisplayStatus } from '@/lib/letters'
import { sectionLabelClass, helperTextClass, secondaryButtonClass, closureTextClass, quietLinkClass } from '@/app/profile/ui'
import FirstLetterComposer from './first-letter-composer'
import ClosureRecommendations from '@/app/letters/closure-recommendations'

export default async function WriteToPage({
  params,
  searchParams,
}: {
  params: Promise<{ recipientId: string }>
  searchParams: Promise<{ a?: string }>
}) {
  const { recipientId } = await params
  const { a: answerId } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  if (recipientId === user.id) {
    redirect('/minds')
  }

  const { data: recipient } = await supabase
    .from('public_profiles')
    .select('pseudonym')
    .eq('id', recipientId)
    .maybeSingle()

  if (!recipient) {
    redirect('/minds')
  }

  const existing = await getFirstContact(supabase, user.id, recipientId)

  if (existing) {
    // getFirstContact's row is always the genuine original first-contact
    // letter for this exact sender->recipient direction (never an
    // ordinary Write-Anytime quill letter, which reply_to_id=null could
    // otherwise be confused with) — established=false is safe and
    // correct here regardless of whether the correspondence later
    // became established, since isEffectivelyExpired's own
    // status === 'sent' check already excludes an established
    // (status='replied') row from the expiry branch either way.
    const expired = isEffectivelyExpired(existing, false)
    // existing.status may already say 'replied' before Mail Call has
    // actually delivered that reply to this viewer (see
    // resolveFirstContactDisplayStatus's own doc comment) — only ask
    // isEstablishedForViewer when it could possibly matter.
    const establishedForViewer =
      existing.status === 'replied' ? await isEstablishedForViewer(supabase, existing.correspondenceId) : false
    const effectiveStatus = expired
      ? 'closed'
      : resolveFirstContactDisplayStatus(existing.status, establishedForViewer)
    const effectiveClosedBy = expired ? 'system' : existing.closedBy

    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 py-10 text-center">
          <p className={sectionLabelClass}>{recipient.pseudonym}</p>

          {effectiveStatus === 'sent' && (
            <p className={helperTextClass}>
              You&apos;ve already written to {recipient.pseudonym}. Your
              letter is waiting for a reply.
            </p>
          )}
          {effectiveStatus === 'replied' && (
            <p className={helperTextClass}>
              {recipient.pseudonym} replied to your letter.
            </p>
          )}
          {effectiveStatus === 'closed' &&
            (effectiveClosedBy === 'recipient' ? (
              <div className="space-y-2">
                <p className={closureTextClass}>
                  {recipient.pseudonym} passed on this letter.
                </p>
                <p className={closureTextClass}>{closeReasonForSender(existing.closeReason)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className={closureTextClass}>This letter went unanswered.</p>
                <p className={closureTextClass}>
                  Its recipient wasn&apos;t able to respond within the reply window.
                </p>
              </div>
            ))}

          {/* Two intentionally different exits: "Your letters" for the
              correspondence-management context, and a direct link back
              to the profile this screen was almost certainly reached
              from — this used to be the only screen in this flow with
              no way back to where the member actually came from. */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/letters" className={secondaryButtonClass}>
              Your letters
            </Link>
            <Link href={`/minds/${recipientId}`} className={quietLinkClass}>
              Back to {recipient.pseudonym}&apos;s profile
            </Link>
          </div>

          {effectiveStatus === 'closed' && (
            <div className="text-left">
              <ClosureRecommendations letterId={existing.id} />
            </div>
          )}
        </div>
      </main>
    )
  }

  // No first contact yet — a real originating answer is required to
  // start one; without it there's nothing legitimate to compose against,
  // so send the member back to Discovery rather than showing a composer
  // that could only fail on submit.
  if (!answerId) {
    redirect('/minds')
  }

  // Initiating a first letter is never gated on having answered a
  // Question yourself — that used to redirect here into the Question
  // flow, discarding this destination entirely. Answering is
  // encouraged elsewhere (a non-blocking indicator on /minds), never a
  // requirement for writing to someone you've already found.
  const { data: answer } = await supabase
    .from('question_answers')
    .select('id, user_id, questions(prompt)')
    .eq('id', answerId)
    .eq('user_id', recipientId)
    .maybeSingle()

  if (!answer) {
    redirect('/minds')
  }

  const question = Array.isArray(answer.questions) ? answer.questions[0] : answer.questions

  return (
    <FirstLetterComposer
      recipientId={recipientId}
      recipientPseudonym={recipient.pseudonym}
      questionAnswerId={answer.id}
      questionPrompt={question?.prompt ?? null}
    />
  )
}

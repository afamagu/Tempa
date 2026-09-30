import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  closeReasonForSender,
  getFirstContact,
  isEffectivelyExpired,
  isEstablishedForViewer,
  resolveFirstContactDisplayStatus,
} from '@/lib/letters'
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
  searchParams: Promise<{ a?: string; source?: string }>
}) {
  const { recipientId } = await params
  const { a: answerId } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  if (recipientId === user.id) redirect('/room')

  const { data: recipient } = await supabase
    .from('public_profiles')
    .select('pseudonym')
    .eq('id', recipientId)
    .maybeSingle()

  if (!recipient) redirect('/room')

  const existing = await getFirstContact(supabase, user.id, recipientId)

  if (existing) {
    const expired = isEffectivelyExpired(existing, false)
    const establishedForViewer =
      existing.status === 'replied'
        ? await isEstablishedForViewer(supabase, existing.correspondenceId)
        : false
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
              You&apos;ve already written to {recipient.pseudonym}. Your letter is waiting for a reply.
            </p>
          )}
          {effectiveStatus === 'replied' && (
            <p className={helperTextClass}>{recipient.pseudonym} replied to your letter.</p>
          )}
          {effectiveStatus === 'closed' &&
            (effectiveClosedBy === 'recipient' ? (
              <div className="space-y-2">
                <p className={closureTextClass}>{recipient.pseudonym} passed on this letter.</p>
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

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/letters" className={secondaryButtonClass}>Your letters</Link>
            <Link href={`/room/${recipientId}`} className={quietLinkClass}>
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

  // A first contact must originate from something the recipient actually wrote.
  // The Room is now the canonical place to recover that context.
  if (!answerId) redirect('/room')

  const { data: answer } = await supabase
    .from('question_answers')
    .select('id, user_id, questions(prompt)')
    .eq('id', answerId)
    .eq('user_id', recipientId)
    .maybeSingle()

  if (!answer) redirect('/room')

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

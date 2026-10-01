'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { classifyContent } from '@/lib/safety'
import { SAFETY_PUBLIC_CONTACT_SHARING_COPY_KEY } from '@/lib/safety/send-with-safety'

export async function publishMemberQuestion(body: string, credit: boolean, acknowledged = false, suggestionId?: string) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { error: 'Please sign in again.' }
  if (typeof body !== 'string' || typeof credit !== 'boolean' || typeof acknowledged !== 'boolean') return { error: 'Invalid question.' }
  const service = createServiceClient()
  let value = body.trim()
  if (suggestionId) {
    const { data, error } = await service.from('room_question_suggestions').select('proposed_question').eq('id', suggestionId).eq('submitted_by', user.id).maybeSingle()
    if (error || !data) return { error: 'Question not found.' }
    value = data.proposed_question.trim()
  }
  if ([...value].length < 10 || [...value].length > 500) return { error: 'Please write a question between 10 and 500 characters.' }
  const limits = await Promise.all(['safety_evaluate', 'question_answer'].map(action => service.rpc('check_rate_limit', { p_subject_id: user.id, p_action: action })))
  if (limits.some(limit => limit.error || limit.data !== true)) return { error: 'Please wait a moment and try again.' }
  const classification = classifyContent(value, { publicSurface: true })
  if (classification.mutationDisposition === 'deny') return { error: 'This question cannot be published. Please revise it.' }
  if (classification.mutationDisposition === 'warn' && !acknowledged) return {
    warning: true,
    copyKey: classification.reasonCodes.includes('PERSONAL_CONTACT_SHARING') ? SAFETY_PUBLIC_CONTACT_SHARING_COPY_KEY : undefined,
  }
  const { error } = await service.rpc('publish_member_question_trusted', {
    p_actor_id: user.id, p_body: value, p_credit: credit,
    p_classification: classification, p_warning_acknowledged: acknowledged,
    p_existing_suggestion_id: suggestionId ?? null,
  })
  if (error) return { error: error.message.startsWith('Suggestion limit reached.') ? 'You can suggest up to three questions a day. Please try again tomorrow.' : 'Could not save your question. Please try again.' }
  revalidatePath('/room')
  revalidatePath(`/room/${user.id}`)
  revalidatePath(`/minds/${user.id}`)
  revalidatePath('/admin/content/questions')
  return { saved: true, pending: classification.escalateCase }
}

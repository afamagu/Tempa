'use server'
import { createClient } from '@/lib/supabase/server'
export async function recordAnswerRead(answerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(answerId)) return
  const supabase = await createClient()
  await supabase.rpc('mark_member_answer_read', { p_answer_id: answerId })
}

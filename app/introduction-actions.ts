'use server'

import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function markIntroductionPresented(candidateId: string): Promise<void> {
  if (typeof candidateId !== 'string' || !UUID.test(candidateId)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id === candidateId) return

  const { error } = await supabase.rpc('mark_member_introduction_presented', {
    p_candidate_id: candidateId,
  })
  if (error) {
    console.error('[introductions] mark_member_introduction_presented failed', {
      message: error.message,
      code: error.code,
    })
  }
}

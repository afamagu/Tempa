'use server'

import { createClient } from '@/lib/supabase/server'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import type { CorrespondentChoice } from '@/lib/correspondent-trigger'

export async function findCorrespondents(query: string): Promise<{ people: CorrespondentChoice[]; error: boolean }> {
  if (typeof query !== 'string' || query.length > 60) return { people: [], error: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { people: [], error: true }
  const { data, error } = await supabase.rpc('correspondent_picker', { p_search: query, p_limit: 20 })
  if (error) return { people: [], error: true }
  return { people: (data ?? []).map((row: { user_id: string; pseudonym: string; mark_id: string | null }) => ({
    userId: row.user_id, pseudonym: row.pseudonym,
    markUrl: row.mark_id ? publicProfileMarkUrl(supabase, `${row.mark_id}.png`) : null,
  })), error: false }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import type { CorrespondentChoice } from '@/lib/correspondent-trigger'

export async function findCorrespondents(query: string, offset = 0): Promise<{ people: CorrespondentChoice[]; error: boolean; hasMore?: boolean }> {
  if (typeof query !== 'string' || query.length > 60 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return { people: [], error: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { people: [], error: true }
  const { data, error } = await supabase.rpc('mention_picker_page', { p_search: query, p_limit: 21, p_offset: offset })
  if (error) return { people: [], error: true }
  return { hasMore: (data ?? []).length > 20, people: (data ?? []).slice(0,20).map((row: { user_id: string; pseudonym: string; mark_id: string | null }) => ({
    userId: row.user_id, pseudonym: row.pseudonym,
    markUrl: row.mark_id ? publicProfileMarkUrl(supabase, `${row.mark_id}.png`) : null,
  })), error: false }
}

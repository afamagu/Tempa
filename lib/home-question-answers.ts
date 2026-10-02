import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryCandidate } from './discovery'

/** Question reading is not matchmaking: correspondents remain eligible.
 * Keep the newest three visible answers, including already-read and own answers. */
export async function getHomeQuestionAnswers(client: SupabaseClient, viewerId: string, question: { id: string; prompt: string }): Promise<DiscoveryCandidate[]> {
  void viewerId // Kept for call-site compatibility; RLS applies the viewer scope.
  const result: DiscoveryCandidate[] = []
  const seen = new Set<string>()
  const pageSize = 48
  for (let offset = 0; result.length < 3; offset += pageSize) {
    const { data: answers, error } = await client.from('question_answers')
      .select('id, question_id, user_id, body, created_at').eq('question_id', question.id)
      .eq('moderation_status', 'visible')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1)
    if (error) return []
    if (!answers?.length) break
    const { data: profiles, error: profileError } = await client.from('public_profiles')
      .select('id, pseudonym, country, mark_id').in('id', answers.map(a => a.user_id))
    if (profileError) return []
    const visibility = await Promise.all((profiles ?? []).map(async p => {
      const { data, error } = await client.rpc('member_question_author_visible', { p_author: p.id })
      return { profile: p, visible: !error && data === true }
    }))
    const byId = new Map(visibility.filter(p => p.visible).map(p => [p.profile.id, p.profile]))
    for (const a of answers) {
      const p = byId.get(a.user_id)
      if (!p || a.question_id !== question.id || seen.has(a.user_id)) continue
      seen.add(a.user_id)
      result.push({ answerId: a.id, userId: a.user_id, pseudonym: p.pseudonym, country: p.country ?? '', markId: p.mark_id, gender: null, genderCustom: null, ageRange: '', body: a.body, prompt: question.prompt })
      if (result.length === 3) break
    }
    if (answers.length < pageSize) break
  }
  return result
}

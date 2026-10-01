import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryCandidate } from './discovery'

/** Question reading is not matchmaking: correspondents remain eligible.
 * Scan in bounded pages so a long read history never hides later unread answers. */
export async function getHomeQuestionAnswers(client: SupabaseClient, viewerId: string, question: { id: string; prompt: string }): Promise<DiscoveryCandidate[]> {
  const result: DiscoveryCandidate[] = []
  const seen = new Set<string>()
  const pageSize = 48
  for (let offset = 0; result.length < 3; offset += pageSize) {
    const { data: answers, error } = await client.from('question_answers')
      .select('id, question_id, user_id, body, created_at').eq('question_id', question.id)
      .eq('moderation_status', 'visible').neq('user_id', viewerId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) return []
    if (!answers?.length) break
    const [{ data: profiles, error: profileError }, { data: reads, error: readError }] = await Promise.all([
      client.from('public_profiles').select('id, pseudonym, country, mark_id').in('id', answers.map(a => a.user_id)),
      client.from('member_answer_reads').select('answer_id').eq('viewer_id', viewerId).in('answer_id', answers.map(a => a.id)),
    ])
    if (profileError || readError) return []
    const visibility = await Promise.all((profiles ?? []).map(async p => {
      const { data, error } = await client.rpc('member_question_author_visible', { p_author: p.id })
      return { profile: p, visible: !error && data === true }
    }))
    const byId = new Map(visibility.filter(p => p.visible).map(p => [p.profile.id, p.profile]))
    const readIds = new Set((reads ?? []).map(r => r.answer_id))
    for (const a of answers) {
      const p = byId.get(a.user_id)
      if (!p || a.question_id !== question.id || readIds.has(a.id) || seen.has(a.user_id)) continue
      seen.add(a.user_id)
      result.push({ answerId: a.id, userId: a.user_id, pseudonym: p.pseudonym, country: p.country ?? '', markId: p.mark_id, gender: null, genderCustom: null, ageRange: '', body: a.body, prompt: question.prompt })
      if (result.length === 3) break
    }
    if (answers.length < pageSize) break
  }
  return result
}

import type { SupabaseClient } from '@supabase/supabase-js'

type Introduction = { id: string; prompt: string; created_at: string }
type SavedAnswer = { question_id: string; created_at: string }

/** Earlier members completed the required writing step before the current
 * introduction existed. A later weekly answer alone is not completion. */
export function hasCompletedIntroduction(introduction: Introduction, answers: SavedAnswer[]): boolean {
  const introducedAt = Date.parse(introduction.created_at)
  return answers.some(answer => answer.question_id === introduction.id ||
    (Number.isFinite(introducedAt) && Date.parse(answer.created_at) < introducedAt))
}

/** Read the member's own saved records directly; a failed lookup is unknown,
 * never evidence that the member still needs to write. */
export async function getIntroductionReminderQuestion(client: SupabaseClient, userId: string): Promise<Introduction | null> {
  try {
    const { data: introduction, error: questionError } = await client.from('questions')
      .select('id, prompt, created_at').eq('is_flagship', true).maybeSingle()
    if (questionError || !introduction) return null
    const { data: answers, error: answerError } = await client.from('question_answers')
      .select('question_id, created_at').eq('user_id', userId)
    if (answerError || !answers) return null
    return hasCompletedIntroduction(introduction, answers) ? null : introduction
  } catch {
    return null
  }
}

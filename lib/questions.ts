import type { SupabaseClient } from '@supabase/supabase-js'

export type ActiveQuestion = {
  id: string
  prompt: string
}

export type CurrentAnswer = {
  questionId: string
  prompt: string
  body: string
  updatedAt: string
}

const MAX_ACTIVE_QUESTIONS = 3

export async function getActiveQuestions(
  supabase: SupabaseClient
): Promise<ActiveQuestion[]> {
  const { data } = await supabase
    .from('questions')
    .select('id, prompt')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(MAX_ACTIVE_QUESTIONS)

  return data ?? []
}

export async function getQuestionById(
  supabase: SupabaseClient,
  questionId: string
): Promise<(ActiveQuestion & { isActive: boolean }) | null> {
  const { data } = await supabase
    .from('questions')
    .select('id, prompt, is_active')
    .eq('id', questionId)
    .maybeSingle()

  if (!data) return null
  return { id: data.id, prompt: data.prompt, isActive: data.is_active }
}

/**
 * A member has exactly one "current" discovery answer at a time
 * (question_answers.is_current), regardless of which of the active
 * Questions they chose. This returns that answer, if any, along with
 * its prompt, even if the underlying Question has since rotated out
 * of is_active — rotation hides an answer from discovery, not from
 * its own author.
 */
export async function getCurrentAnswer(
  supabase: SupabaseClient,
  userId: string
): Promise<CurrentAnswer | null> {
  const { data } = await supabase
    .from('question_answers')
    .select('question_id, body, updated_at, questions(prompt)')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (!data) return null

  const question = Array.isArray(data.questions) ? data.questions[0] : data.questions

  return {
    questionId: data.question_id,
    prompt: question?.prompt ?? '',
    body: data.body,
    updatedAt: data.updated_at,
  }
}

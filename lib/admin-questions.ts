import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

export type AdminQuestion = {
  id: string
  slug: string | null
  family: string | null
  prompt: string
  isActive: boolean
  currentPosition: 1 | 2 | 3 | null
  isFlagship: boolean
  answerCount: number
  firstLetterCount: number
  createdAt: string | null
}

export async function listQuestions(
  supabase: SupabaseClient
): Promise<{ data: AdminQuestion[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_questions')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    slug: string | null
    family: string | null
    prompt: string
    is_active: boolean
    current_position: 1 | 2 | 3 | null
    is_flagship: boolean
    answer_count: number
    first_letter_count: number
    created_at: string | null
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      family: r.family,
      prompt: r.prompt,
      isActive: r.is_active,
      currentPosition: r.current_position,
      isFlagship: r.is_flagship,
      answerCount: r.answer_count,
      firstLetterCount: r.first_letter_count,
      createdAt: r.created_at,
    })),
    error: null,
  }
}

export async function editCurrentQuestion(
  supabase: SupabaseClient,
  questionId: string,
  newPrompt: string
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_edit_current_question', {
    p_question_id: questionId,
    p_new_prompt: newPrompt.trim(),
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function addCurrentQuestion(
  supabase: SupabaseClient,
  position: 1 | 2 | 3,
  prompt: string
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_add_current_question', {
    p_position: position,
    p_prompt: prompt.trim(),
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function setQuestionFlagship(
  supabase: SupabaseClient,
  questionId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_question_flagship', { p_question_id: questionId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/**
 * Makes one active, non-Flagship Question the sole live Room Question.
 * The server clears only other non-Flagship positions, never the First
 * Question/Flagship, and never rewrites historical answers.
 */
export async function makeCurrentRoomQuestion(
  supabase: SupabaseClient,
  questionId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_make_current_room_question', { p_question_id: questionId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function setQuestionActive(
  supabase: SupabaseClient,
  questionId: string,
  active: boolean
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_question_active', { p_question_id: questionId, p_active: active })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function updateQuestionPrompt(
  supabase: SupabaseClient,
  questionId: string,
  prompt: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_update_question_prompt', {
    p_question_id: questionId,
    p_prompt: prompt.trim(),
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function createQuestion(
  supabase: SupabaseClient,
  prompt: string,
  family?: string | null
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_create_question', {
    p_prompt: prompt.trim(),
    p_family: family?.trim() || null,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function replaceQuestion(
  supabase: SupabaseClient,
  questionId: string,
  newPrompt: string,
  options: { newActive?: boolean; deactivateOld?: boolean } = {}
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_replace_question', {
    p_question_id: questionId,
    p_new_prompt: newPrompt.trim(),
    p_new_active: options.newActive ?? null,
    p_deactivate_old: options.deactivateOld ?? true,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function setQuestionPosition(
  supabase: SupabaseClient,
  questionId: string,
  position: 1 | 2 | 3 | null
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_question_position', {
    p_question_id: questionId,
    p_position: position,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}


/** Start a Room week atomically. If the selected wording already owns answers,
 * the database creates a fresh Question identity so old answers never become
 * answers to the new weekly round. */
export async function startRoomQuestion(
  supabase: SupabaseClient,
  questionId: string,
  restart = false
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_start_room_question', {
    p_question_id: questionId,
    p_restart: restart,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center Phase 2A-1 — Questions management. All three
 * RPCs are admin-floor only (is_staff('admin'), checked server-side —
 * see docs/sql/2026-09-10-admin-moderation-and-questions.sql). Scoped
 * to the 3 canonical Questions only (`slug is not null`). No Create
 * wrapper here, deliberately (Decision 2, Phase 2A-1 design) — the
 * member runtime only ever offers the fixed CANONICAL_QUESTION_SLUGS
 * set (lib/questions.ts), so an admin-created row would never actually
 * reach a member; building a Create control here would be exactly the
 * "fake control" the design explicitly rejected.
 */

export type AdminQuestion = {
  id: string
  slug: string
  prompt: string
  isActive: boolean
  answerCount: number
  firstLetterCount: number
}

export async function listQuestions(
  supabase: SupabaseClient
): Promise<{ data: AdminQuestion[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_questions')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    slug: string
    prompt: string
    is_active: boolean
    answer_count: number
    first_letter_count: number
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      prompt: r.prompt,
      isActive: r.is_active,
      answerCount: r.answer_count,
      firstLetterCount: r.first_letter_count,
    })),
    error: null,
  }
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

/** Rejected server-side (not just here) whenever the Question already
 * has >= 1 answer — the LOCKED immutability rule. This wrapper never
 * pre-empts that check; it exists only for a consistent call shape. */
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

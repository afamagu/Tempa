import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center — Questions library management. All RPCs are
 * admin-floor only (is_staff('admin'), checked server-side — see
 * docs/sql/2026-09-10-admin-moderation-and-questions.sql and
 * docs/sql/2026-09-18-admin-operations-refinement.sql). No longer
 * scoped to the 3 canonical Questions — this lists and manages the
 * FULL Questions library.
 *
 * Admin Operations Refinement checkpoint — Create and Replace exist
 * now, but a Question created/replaced here is deliberately NOT the
 * same thing as making it live to members: it's created with
 * `slug: null` and inactive. Only a separate, later code change to
 * CANONICAL_QUESTION_SLUGS (lib/questions.ts) plus assigning a slug
 * makes a Question part of what the member runtime actually offers.
 * This checkpoint does not touch that constant or replace the current
 * live flagship Questions.
 */

export type AdminQuestion = {
  id: string
  slug: string | null
  family: string | null
  prompt: string
  isActive: boolean
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
      answerCount: r.answer_count,
      firstLetterCount: r.first_letter_count,
      createdAt: r.created_at,
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

/** Always creates a brand new, inactive, non-canonical Question. */
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

/** The safe workflow for an ANSWERED Question that needs different
 * wording — creates a NEW Question row with the revised prompt and
 * never rewrites or reassigns any historical answer.
 *
 * `options.newActive` (default undefined -> server-side null): the
 * replacement's active state. Omitted, this MIRRORS the old Question's
 * own active state at call time (old active -> new active; old
 * inactive -> new inactive) — the operationally intuitive default from
 * the Question source-of-truth correction (Section 3): replacing a
 * live, answered, active Question should make the revised wording take
 * over immediately, not silently vanish from what members are offered.
 * Pass an explicit true/false to override that default.
 * `options.deactivateOld` (default true): whether the OLD Question is
 * deactivated as part of this same call. */
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

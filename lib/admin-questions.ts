import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center — Questions library management. All RPCs are
 * admin-floor only (is_staff('admin'), checked server-side — see
 * docs/sql/2026-09-10-admin-moderation-and-questions.sql,
 * docs/sql/2026-09-18-admin-operations-refinement.sql, and
 * docs/sql/2026-09-19-question-slots-and-premium-announcements.sql).
 * Lists and manages the FULL Questions library.
 *
 * Question Slots checkpoint — the current member-facing experience is
 * driven entirely by `currentPosition` (1 = permanent flagship, 2, 3,
 * or null for an unpositioned library/history Question), assigned only
 * via setQuestionPosition or as a side effect of replaceQuestion. slug
 * remains a legitimate identifier but never gates or orders anything.
 * Question #1 is flagship-protected: setQuestionActive and
 * replaceQuestion both refuse to touch it once positioned; only
 * setQuestionPosition may move it, and even that call refuses to move
 * #1 away or let another Question evict it — installing/replacing the
 * flagship itself is deliberately out of scope for this casual control
 * (see docs/sql's own comment for why that's not overbuilt here).
 */

export type AdminQuestion = {
  id: string
  slug: string | null
  family: string | null
  prompt: string
  isActive: boolean
  currentPosition: 1 | 2 | 3 | null
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
      answerCount: r.answer_count,
      firstLetterCount: r.first_letter_count,
      createdAt: r.created_at,
    })),
    error: null,
  }
}

/** Refused server-side for Question #1 (flagship protection) whenever
 * `active` is false — deactivating any OTHER positioned Question also
 * vacates its slot in the same server-side statement. */
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

/** Always creates a brand new, inactive, unpositioned Question. */
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
 * never rewrites or reassigns any historical answer. Refused server-
 * side outright for Question #1 (flagship protection).
 *
 * `options.newActive` (default undefined -> server-side null): the
 * replacement's active state. Omitted, this MIRRORS the old Question's
 * own active state at call time (old active -> new active; old
 * inactive -> new inactive) — the operationally intuitive default:
 * replacing a live, answered, active Question should make the revised
 * wording take over immediately, not silently vanish from what members
 * are offered. Pass an explicit true/false to override that default.
 * `options.deactivateOld` (default true): whether the OLD Question is
 * deactivated as part of this same call — when true, the OLD
 * Question's current slot (if any) is carried forward to the
 * replacement automatically ("replacing #2 must produce a new Question
 * that occupies #2"); when false, the old Question keeps its slot and
 * the replacement is created unpositioned. */
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

/** Assigns an existing ACTIVE library Question to slot 1, 2, or 3
 * (evicting whichever OTHER Question currently holds that slot, if
 * any — never #1, which this refuses to evict or move, flagship
 * protection), or clears a Question's slot back to null (`position:
 * null`) to unpin it without deactivating it. This is how #1/#2/#3 are
 * populated in the first place, and how the library can be reordered
 * without touching any wording at all. */
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

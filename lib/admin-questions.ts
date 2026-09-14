import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center — Questions management. All RPCs are
 * admin-floor only (is_staff('admin'), checked server-side — see
 * docs/sql/2026-09-10-admin-moderation-and-questions.sql,
 * docs/sql/2026-09-18-admin-operations-refinement.sql,
 * docs/sql/2026-09-19-question-slots-and-premium-announcements.sql,
 * and docs/sql/2026-09-20-question-flagship-simplification.sql).
 *
 * ACTUAL PRODUCT MODEL (Flagship Simplification correction) — TEMPA
 * has exactly THREE current Questions (`currentPosition` 1/2/3, at
 * most one Question per slot). Exactly one of the three is Flagship —
 * `isFlagship`, a SEPARATE bit of state, never tied to any particular
 * slot number (the prior "#1 is the permanent flagship" model was
 * wrong and has been removed). The simplified Admin surface uses three
 * primitives directly:
 *   - editCurrentQuestion — the ONE "Edit Question" action per slot
 *     (in place if zero answers, otherwise a preserved-history
 *     replacement that inherits the same slot and Flagship status).
 *   - addCurrentQuestion — the ONE "Add Question" action for an empty
 *     slot.
 *   - setQuestionFlagship — the ONE "make this the Flagship" action,
 *     a plain radio-button swap.
 * The lower-level primitives below (setQuestionActive, replaceQuestion,
 * setQuestionPosition, createQuestion, updateQuestionPrompt) remain as
 * DB-level building blocks (and are what editCurrentQuestion/
 * addCurrentQuestion are implemented on top of, server-side) but are
 * deliberately NOT used directly by the simplified Admin UI — no
 * manual activate/deactivate/re-pin/replace workflow is exposed there.
 */

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

/** The single "Edit Question" action for one of the three current
 * slots — the server decides in-place-edit vs. preserved-history
 * replacement based on whether the Question has any answers yet; the
 * caller never needs to know which happened. Returns the id that now
 * occupies the slot (the same id if edited in place, a new id if
 * replaced). Only callable on a CURRENT (positioned) Question. */
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

/** The single "Add Question" action for an EMPTY slot — creates a
 * brand new Question and makes it current in one call. Refused
 * server-side if the target slot is already occupied. */
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

/** The single "make this the Flagship" action — a plain radio-button
 * swap. Sets Flagship on the target Question and automatically clears
 * it from whichever OTHER Question currently holds it, atomically.
 * Only callable on a CURRENT (positioned) Question. */
export async function setQuestionFlagship(
  supabase: SupabaseClient,
  questionId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_question_flagship', { p_question_id: questionId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** Lower-level primitive — not used by the simplified Admin UI (see
 * this file's own header). Deactivating any positioned Question also
 * vacates its slot, and clears Flagship if it held it, in the same
 * server-side statement. Nothing about slot #1 is special anymore. */
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

/** Lower-level primitive — not used by the simplified Admin UI
 * (editCurrentQuestion is built on top of this same idea, atomically,
 * from a single "Edit Question" action). The safe workflow for an
 * ANSWERED Question that needs different wording — creates a NEW
 * Question row with the revised prompt and never rewrites or reassigns
 * any historical answer. Nothing about slot #1 is special anymore.
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
 * Question's current slot AND Flagship status (if any) are carried
 * forward to the replacement automatically, but only when the
 * replacement itself ends up active; when false, the old Question
 * keeps its slot/Flagship status and the replacement is created
 * unpositioned. */
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

/** Lower-level primitive — not used by the simplified Admin UI
 * (addCurrentQuestion covers "populate an empty slot" atomically;
 * nothing on the simplified surface re-pins an already-current
 * Question). Assigns an existing ACTIVE Question to slot 1, 2, or 3
 * (evicting whichever OTHER Question currently holds that slot, if
 * any — clearing its Flagship status too, if it held one), or clears a
 * Question's slot back to null (`position: null`) to unpin it without
 * deactivating it. Nothing about slot #1 is special anymore. */
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

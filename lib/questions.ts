import type { SupabaseClient } from '@supabase/supabase-js'

export type ActiveQuestion = {
  id: string
  prompt: string
}

/**
 * The 3 originally-seeded Questions' stable slugs
 * (docs/sql/2026-09-03-canonical-questions.sql). Neither slug
 * membership NOR this constant plays any role in member-reachability
 * or Question order — Question Slots checkpoint: `questions.
 * current_position` (1/2/3, explicit Admin assignment only) is the
 * sole source of truth for what's currently offered and in what order.
 * Kept only because slug remains a legitimate, stable identifier for
 * these 3 specific rows.
 */
export const CANONICAL_QUESTION_SLUGS = [
  'private_ritual',
  'place_outsiders_miss',
  'ordinary_worth_protecting',
] as const

export type CanonicalSlug = (typeof CANONICAL_QUESTION_SLUGS)[number]

/**
 * TEMPA's canonical "stranger/discovery writing" length cap
 * (2026-09-05 length-policy audit). This is the actual, currently-live
 * Question-answer maximum — matches the live
 * question_answers_body_max_length check constraint (<= 2000) exactly.
 * Question is the canonical source: the first-contact letter composer
 * (app/write/[recipientId]/first-letter-composer.tsx) imports this
 * SAME constant rather than hard-coding a second independent number,
 * so the two values can never silently drift apart.
 */
export const QUESTION_ANSWER_MAX_CHARS = 2000

export type QuestionPosition = 1 | 2 | 3

export type LibraryQuestion = {
  id: string
  prompt: string
  position: QuestionPosition
}

/**
 * Question Slots checkpoint. Replaces the previous "up to three,
 * family-diverse, picked from the whole active library" selection
 * entirely: there is no longer a pool to pick FROM — the current three
 * Questions are #1/#2/#3, an explicit Admin assignment
 * (questions.current_position), never computed or ranked. This
 * function does exactly one thing: fetch whichever of #1/#2/#3
 * currently exist, in slot order, and drop any this member has already
 * answered. `family` no longer drives anything at the member-facing
 * layer (see docs/sql/2026-09-19-question-slots-and-premium-
 * announcements.sql's own header comment) — it remains pure admin
 * curation metadata.
 *
 * `current_position is not null` already implies `is_active = true`
 * (questions_current_position_requires_active, enforced at the
 * database level and re-enforced by admin_set_question_active clearing
 * a Question's position the instant it's deactivated) — so this query
 * needs no separate is_active filter of its own.
 */
export async function getEligibleQuestions(
  supabase: SupabaseClient,
  userId: string
): Promise<LibraryQuestion[]> {
  const [{ data: positionedRows }, { data: answeredRows }] = await Promise.all([
    supabase
      .from('questions')
      .select('id, prompt, current_position')
      .not('current_position', 'is', null)
      .order('current_position', { ascending: true }),
    supabase.from('question_answers').select('question_id').eq('user_id', userId),
  ])

  const answeredIds = new Set((answeredRows ?? []).map((r) => r.question_id as string))
  return (positionedRows ?? [])
    .filter((q) => !answeredIds.has(q.id))
    .map((q) => ({ id: q.id, prompt: q.prompt, position: q.current_position as QuestionPosition }))
}

/**
 * The current Flagship Question, or null if none is currently
 * assigned. Flagship Simplification correction — Flagship is a
 * separate, admin-chosen bit of state (questions.is_flagship), never
 * tied to any particular slot number; it is NOT permanently position
 * #1 (that was the prior, over-engineered model). This is the single
 * source of truth for "which Question defines a member's primary
 * Minds identity" — see getPrimaryAnswer below.
 */
export async function getFlagshipQuestion(
  supabase: SupabaseClient
): Promise<{ id: string; prompt: string } | null> {
  const { data } = await supabase
    .from('questions')
    .select('id, prompt')
    .eq('is_flagship', true)
    .maybeSingle()
  return data ? { id: data.id, prompt: data.prompt } : null
}

export type PrimaryAnswer = {
  id: string
  questionId: string
  prompt: string
  body: string
  updatedAt: string
}

/**
 * The member's PRIMARY identity answer, for Minds cards/previews and
 * the Profile default. Deliberately NEVER falls back to another
 * current Question, and deliberately does NOT read `is_current` at
 * all: is_current is member-choosable and could point at any answer,
 * but "primary" is no longer a member choice — it is always and only
 * the answer to whichever Question is currently Flagship (dynamic,
 * admin-chosen, never permanently tied to a slot — see
 * getFlagshipQuestion above). A member who hasn't answered the current
 * Flagship yet (or whose Flagship answer is currently hidden by
 * moderation) has no primary answer at all — never a silent substitute
 * from another current Question.
 */
export async function getPrimaryAnswer(
  supabase: SupabaseClient,
  userId: string
): Promise<PrimaryAnswer | null> {
  const flagship = await getFlagshipQuestion(supabase)
  if (!flagship) return null

  const { data } = await supabase
    .from('question_answers')
    .select('id, body, updated_at')
    .eq('question_id', flagship.id)
    .eq('user_id', userId)
    .eq('moderation_status', 'visible')
    .maybeSingle()

  if (!data) return null
  return { id: data.id, questionId: flagship.id, prompt: flagship.prompt, body: data.body, updatedAt: data.updated_at }
}

export type MyQuestionAnswer = {
  /** The question_answers row's own id — what set_current_answer and
   * the write flow key off, distinct from questionId. */
  id: string
  questionId: string
  prompt: string
  body: string
  updatedAt: string
  isCurrent: boolean
  /** True exactly when this answer's Question is the current Flagship
   * (questions.is_flagship — a separate, admin-chosen bit of state,
   * never tied to a particular slot number). This is the one true
   * "primary identity answer" flag now; `isCurrent` is retained
   * unchanged (member-choosable, still governs nothing about primary
   * identity — see this file's own header discussion) purely for
   * backward compatibility with historical data and the still-live
   * set_current_answer RPC. */
  isPrimary: boolean
  /** Admin Phase 2A-1 — 'hidden' only ever reaches the CALLER when the
   * caller is this answer's own author (question_answers' self-select
   * RLS policy; every other viewer's row is excluded entirely before
   * this ever runs). The owner's own profile view renders "Hidden by
   * TEMPA" for it instead of the normal answer card. */
  moderationStatus: 'visible' | 'hidden'
}

/**
 * Pure: pairs a member's raw question_answers rows with the prompt of
 * the Question each belongs to (and whether that Question is currently
 * Flagship). A member's answer to ANY Question in the library is real,
 * historical content of theirs and is always included here, regardless
 * of whether that Question is still active, still positioned, or was
 * ever "canonical." The only row ever dropped is one whose parent
 * Question can't be resolved at all — which in practice never happens,
 * since a Question is never hard-deleted while it still has answers.
 */
export function buildMyAnswers(
  answerRows: {
    id: string
    question_id: string
    body: string
    updated_at: string
    is_current: boolean
    moderation_status: 'visible' | 'hidden'
  }[],
  questionsById: Map<string, { prompt: string; is_flagship: boolean }>
): MyQuestionAnswer[] {
  return answerRows
    .filter((row) => questionsById.has(row.question_id))
    .map((row) => {
      const question = questionsById.get(row.question_id)!
      return {
        id: row.id,
        questionId: row.question_id,
        prompt: question.prompt,
        body: row.body,
        updatedAt: row.updated_at,
        isCurrent: row.is_current,
        isPrimary: question.is_flagship,
        moderationStatus: row.moderation_status,
      }
    })
}

/**
 * Every Question-answer this member has ever written, to ANY Question
 * in the library — "My answers"/"other answers" own history, complete,
 * regardless of whether the underlying Question is still active or
 * positioned.
 */
export async function getMyAnswers(
  supabase: SupabaseClient,
  userId: string
): Promise<MyQuestionAnswer[]> {
  const { data: answerRows } = await supabase
    .from('question_answers')
    .select('id, question_id, body, updated_at, is_current, moderation_status')
    .eq('user_id', userId)

  if (!answerRows || answerRows.length === 0) return []

  const questionIds = [...new Set(answerRows.map((r) => r.question_id))]
  const { data: questionRows } = await supabase
    .from('questions')
    .select('id, prompt, is_flagship')
    .in('id', questionIds)

  const questionsById = new Map(
    (questionRows ?? []).map((q) => [q.id, { prompt: q.prompt, is_flagship: q.is_flagship }])
  )
  return buildMyAnswers(answerRows, questionsById)
}

/**
 * Pure: whichever eligible Question comes first, excluding the one the
 * member just answered/is currently viewing — `eligible` is already in
 * #1/#2/#3 slot order (getEligibleQuestions), so this is simply "the
 * first one that isn't the current page's own Question."
 */
export function nextEligibleQuestion(
  eligible: LibraryQuestion[],
  currentQuestionId: string
): LibraryQuestion | null {
  return eligible.find((q) => q.id !== currentQuestionId) ?? null
}

/**
 * Pure: whether a member still needs to answer a Question — one
 * completed answer is enough, never a specific count, and this is
 * never true at all when there's nothing currently eligible to offer
 * (eligibleQuestionCount === 0). Despite the name, this no longer gates
 * any navigation — it now drives only the non-blocking "Answer a
 * Question" indicator on /minds (the dot on its tab, and
 * QuestionIncompleteNotice). Browsing Minds, opening a profile, reading
 * a published answer, and starting a first letter are never blocked by
 * this being true.
 */
export function needsParticipationGate(
  eligibleQuestionCount: number,
  completedAnswerCount: number
): boolean {
  if (eligibleQuestionCount === 0 && completedAnswerCount === 0) return false
  return completedAnswerCount === 0
}

/**
 * Pure: the save-confirmation copy for a Question answer. Does not
 * read `is_current`/`wasCurrent` at all: the ONLY save that is ever
 * announced as "now your primary Minds answer" is a member's very
 * FIRST save of an answer to whichever Question is currently Flagship
 * (isFlagship — a separate, admin-chosen bit of state, never
 * permanently tied to a slot). Every other save — including a first
 * answer to a non-Flagship current Question, and every edit of an
 * already-answered Flagship Question — gets the plain copy. This keeps
 * the message truthful under the model: is_current can still silently
 * flip server-side (publish_question_answer's own unchanged promotion
 * rule), but that is no longer what makes an answer "featured," so it
 * is no longer what this copy announces.
 */
export function questionSaveConfirmationCopy(isFlagship: boolean, hadExistingAnswer: boolean): string {
  if (isFlagship && !hadExistingAnswer) return 'Saved. This is now your primary response.'
  return 'Response saved.'
}

export async function getQuestionById(
  supabase: SupabaseClient,
  questionId: string
): Promise<(ActiveQuestion & { isActive: boolean; position: QuestionPosition | null; isFlagship: boolean }) | null> {
  const { data } = await supabase
    .from('questions')
    .select('id, prompt, is_active, current_position, is_flagship')
    .eq('id', questionId)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    prompt: data.prompt,
    isActive: data.is_active,
    position: data.current_position,
    isFlagship: data.is_flagship,
  }
}

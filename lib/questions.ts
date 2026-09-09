import type { SupabaseClient } from '@supabase/supabase-js'

export type ActiveQuestion = {
  id: string
  prompt: string
}

// Tempa's three permanent canonical Questions — every member sees the
// exact same three, never rotated, never drawn from a larger library.
// Order here is the only display order that matters anywhere in the
// app; `questions.slug` (docs/sql/2026-09-03-canonical-questions.sql)
// is the stable identifier the app keys off instead of a raw uuid, so
// a fresh environment can be reseeded without any code change as long
// as the same three slugs are used.
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
 * so the two values can never silently drift apart. Both surfaces are
 * writing shown to, or sent to, someone who hasn't agreed to hear from
 * you yet — a stranger reading Minds, or a stranger receiving an
 * unsolicited Letter 1 — which is the actual product rationale for
 * capping length at all here.
 *
 * Deliberately NOT used once a correspondence is established (Write
 * Anytime, Letter 3+) or for the reply that establishes one (Letter 2,
 * app/letters/[letterId]/first-contact-response.tsx) — TEMPA has no
 * product-level maximum length for an ordinary letter between two
 * people who have each chosen to correspond.
 */
export const QUESTION_ANSWER_MAX_CHARS = 2000

export type CanonicalQuestion = {
  id: string
  slug: CanonicalSlug
  prompt: string
}

/**
 * Pure: fixes the canonical Questions' display order and drops
 * anything that isn't one of the three known slugs (every historical/
 * retired Question has `slug = null` and is silently excluded here,
 * never touched). Split out from getCanonicalQuestions so "exactly
 * these three, in this order" is unit-testable without a database.
 */
export function pickCanonicalQuestions(
  rows: { id: string; slug: string | null; prompt: string }[]
): CanonicalQuestion[] {
  const bySlug = new Map(rows.filter((r) => r.slug).map((r) => [r.slug as string, r]))
  return CANONICAL_QUESTION_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (r): r is { id: string; slug: string; prompt: string } => Boolean(r)
  ).map((r) => ({ id: r.id, slug: r.slug as CanonicalSlug, prompt: r.prompt }))
}

/**
 * The three canonical Questions, in fixed display order. Degrades to
 * an empty array (rather than throwing) if `questions.slug` hasn't
 * been added yet or the three rows haven't been seeded — every caller
 * below treats an empty result as "canonical Questions aren't live in
 * this database yet," never as "this member has no Questions."
 */
export async function getCanonicalQuestions(
  supabase: SupabaseClient
): Promise<CanonicalQuestion[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('id, slug, prompt')
    .in('slug', CANONICAL_QUESTION_SLUGS as unknown as string[])

  if (error || !data) return []
  return pickCanonicalQuestions(data)
}

export type CanonicalAnswer = {
  /** The question_answers row's own id — what set_current_answer and
   * the write flow key off, distinct from questionId. */
  id: string
  questionId: string
  slug: CanonicalSlug
  prompt: string
  body: string
  updatedAt: string
  isCurrent: boolean
}

/**
 * Pure: pairs this member's question_answers rows with the canonical
 * Questions they belong to, and — critically — filters out every row
 * whose question isn't canonical. A historical/retired answer is
 * simply never inspected here, never included in the result; nothing
 * about it is read, mutated, or lost. Split out for direct testing
 * ("old answers remain untouched by the canonical view") without a
 * database.
 */
export function buildCanonicalAnswers(
  canonicalQuestions: CanonicalQuestion[],
  answerRows: {
    id: string
    question_id: string
    body: string
    updated_at: string
    is_current: boolean
  }[]
): CanonicalAnswer[] {
  const byQuestionId = new Map(canonicalQuestions.map((q) => [q.id, q]))
  return answerRows
    .filter((row) => byQuestionId.has(row.question_id))
    .map((row) => {
      const q = byQuestionId.get(row.question_id)!
      return {
        id: row.id,
        questionId: row.question_id,
        slug: q.slug,
        prompt: q.prompt,
        body: row.body,
        updatedAt: row.updated_at,
        isCurrent: row.is_current,
      }
    })
}

/**
 * This member's answers to the three canonical Questions only —
 * distinct from every historical answer they may also have, which
 * this deliberately never returns (see buildCanonicalAnswers).
 */
export async function getCanonicalAnswers(
  supabase: SupabaseClient,
  userId: string
): Promise<CanonicalAnswer[]> {
  const canonical = await getCanonicalQuestions(supabase)
  if (canonical.length === 0) return []

  const { data } = await supabase
    .from('question_answers')
    .select('id, question_id, body, updated_at, is_current')
    .eq('user_id', userId)
    .in(
      'question_id',
      canonical.map((q) => q.id)
    )

  return buildCanonicalAnswers(canonical, data ?? [])
}

export type CanonicalQuestionState = CanonicalQuestion & { answer: CanonicalAnswer | null }

/**
 * Pure: pairs each of the three canonical Questions with this
 * member's answer to it (or null if not yet answered) — "Answer a
 * Question"'s completed/uncompleted state, always all three, in fixed
 * order, regardless of answer order.
 */
export function mergeCanonicalQuestionState(
  questions: CanonicalQuestion[],
  answers: CanonicalAnswer[]
): CanonicalQuestionState[] {
  const byQuestionId = new Map(answers.map((a) => [a.questionId, a]))
  return questions.map((q) => ({ ...q, answer: byQuestionId.get(q.id) ?? null }))
}

/**
 * Pure: the next unanswered canonical Question after `currentQuestionId`
 * in fixed canonical order, wrapping around rather than just "the next
 * slug" — the immediately-following Question may already be answered
 * (e.g. editing #1 while #2 is done and #3 isn't should offer #3), and
 * an already-completed Question being revisited must still point at
 * whichever canonical Question is genuinely still unanswered, in
 * canonical order, wherever it falls. Returns null when
 * currentQuestionId isn't canonical, or every other canonical Question
 * is already answered.
 */
export function nextUnansweredCanonicalQuestion(
  currentQuestionId: string,
  questions: CanonicalQuestionState[]
): CanonicalQuestion | null {
  const current = questions.find((q) => q.id === currentQuestionId)
  if (!current) return null

  const bySlug = new Map(questions.map((q) => [q.slug, q]))
  const currentOrderIndex = CANONICAL_QUESTION_SLUGS.indexOf(current.slug)

  for (let step = 1; step < CANONICAL_QUESTION_SLUGS.length; step++) {
    const slug = CANONICAL_QUESTION_SLUGS[(currentOrderIndex + step) % CANONICAL_QUESTION_SLUGS.length]
    const candidate = bySlug.get(slug)
    if (candidate && candidate.answer === null) {
      return { id: candidate.id, slug: candidate.slug, prompt: candidate.prompt }
    }
  }
  return null
}

/**
 * Pure: whether a member still needs to answer a canonical Question —
 * one completed answer is enough, never all three, and this is never
 * true at all when canonical Questions aren't live in this database yet
 * (canonicalQuestionCount === 0). Despite the name, this no longer
 * gates any navigation (see app/minds/page.tsx,
 * app/minds/[userId]/page.tsx, app/write/[recipientId]/page.tsx) — it
 * now drives only the non-blocking "Answer a Question" indicator on
 * /minds (the dot on its tab, and QuestionIncompleteNotice). Browsing
 * Minds, opening a profile, reading a published answer, and starting a
 * first letter are never blocked by this being true.
 */
export function needsParticipationGate(
  canonicalQuestionCount: number,
  completedCanonicalAnswerCount: number
): boolean {
  if (canonicalQuestionCount === 0) return false
  return completedCanonicalAnswerCount === 0
}

/**
 * Pure: the save-confirmation copy for a Question answer, distinguishing
 * "this specific save just became the member's featured (Shown in
 * Minds) answer" from an ordinary save. Never conflates saving a
 * Question answer with sending a letter — there is no recipient, no
 * correspondence, and no Mail Call involved in either case, only
 * publish_question_answer's own is_current promotion rule (see
 * docs/sql/2026-09-03-publish-question-answer-canonical.sql: a
 * member's first-ever canonical answer is auto-featured; every later
 * save leaves an existing featured answer alone). `wasCurrent` is the
 * answer's own is_current value BEFORE this save; `nowCurrent` is what
 * the RPC returned AFTER it — only a false-to-true transition counts
 * as "just became featured," never an edit of an already-featured
 * answer.
 */
export function questionSaveConfirmationCopy(wasCurrent: boolean, nowCurrent: boolean): string {
  if (!wasCurrent && nowCurrent) return 'Saved. This answer is now featured in Minds.'
  return 'Answer saved.'
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

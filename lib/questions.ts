import type { SupabaseClient } from '@supabase/supabase-js'

export type ActiveQuestion = {
  id: string
  prompt: string
}

/**
 * The 3 originally-seeded Questions' stable slugs
 * (docs/sql/2026-09-03-canonical-questions.sql). Question source-of-
 * truth correction: these NO LONGER gate member-reachability anywhere
 * — `is_active` is the only gate now (see getEligibleQuestions below).
 * The constant is kept only because slug remains a legitimate, stable
 * identifier for these 3 specific rows (a future curator may still use
 * a slug the same way for a new seeded Question); nothing in this file
 * branches on membership in this array anymore.
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

/** Internal curation grouping (questions.family — added 2026-09-01,
 * free text). Not a CHECK-enforced enum; the three the app currently
 * knows how to prioritize are 'reflection' | 'everyday' | 'imagination'
 * (in that order), but a null/unknown family is never excluded from
 * the library entirely — it's simply picked last, after every
 * recognized family has had its turn. */
const KNOWN_FAMILY_ORDER = ['reflection', 'everyday', 'imagination']

export type LibraryQuestion = {
  id: string
  prompt: string
  family: string | null
}

/**
 * Pure: the actual "up to three, family-diverse" selection Answer a
 * Question rotation was always meant to do (see docs/sql/2026-09-01-
 * question-families.sql's own design comment — the family column was
 * added for exactly this, but nothing ever read it at runtime until
 * this Question source-of-truth correction). `rows` should already be
 * is_active-only and already exclude anything the member has answered
 * — this function's only job is picking a family-diverse subset, never
 * filtering by activity/answered-state itself, so it stays trivially
 * testable without a database.
 *
 * Algorithm: group by family (unrecognized/null family is its own
 * bucket, tried last); walk recognized families in KNOWN_FAMILY_ORDER,
 * then any other family alphabetically, then the null bucket, taking
 * one Question per pass; repeat passes until `limit` is reached or
 * every bucket is empty. Within a bucket, `rows`' own order is
 * preserved (the caller queries oldest-first — see
 * getEligibleQuestions — so this never invents a popularity/ranking
 * signal of its own). Never throws; degrades to fewer than `limit`
 * when the pool itself has fewer than `limit` Questions.
 */
export function selectEligibleQuestions(
  rows: LibraryQuestion[],
  limit = 3
): LibraryQuestion[] {
  const byFamily = new Map<string, LibraryQuestion[]>()
  for (const q of rows) {
    const key = q.family ?? ''
    if (!byFamily.has(key)) byFamily.set(key, [])
    byFamily.get(key)!.push(q)
  }

  const familyKeys = [...byFamily.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    const ai = KNOWN_FAMILY_ORDER.indexOf(a)
    const bi = KNOWN_FAMILY_ORDER.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  const selected: LibraryQuestion[] = []
  let tookOne = true
  while (selected.length < limit && tookOne) {
    tookOne = false
    for (const key of familyKeys) {
      if (selected.length >= limit) break
      const bucket = byFamily.get(key)!
      const next = bucket.shift()
      if (next) {
        selected.push(next)
        tookOne = true
      }
    }
  }
  return selected
}

/**
 * The Questions currently OFFERED to answer fresh: up to three, active,
 * excluding anything this member has already answered, preferring
 * family diversity (selectEligibleQuestions above). This is the
 * genuine database-backed replacement for the old hardcoded-three
 * CANONICAL_QUESTION_SLUGS gate — an Admin-activated Question (created
 * or replaced via admin_create_question/admin_replace_question)
 * appears here as soon as it's active, with no further code change or
 * deploy required. Degrades to an empty array (never throws) when the
 * library has nothing eligible left for this member.
 */
export async function getEligibleQuestions(
  supabase: SupabaseClient,
  userId: string
): Promise<LibraryQuestion[]> {
  const [{ data: activeRows }, { data: answeredRows }] = await Promise.all([
    supabase
      .from('questions')
      .select('id, prompt, family')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('question_answers').select('question_id').eq('user_id', userId),
  ])

  const answeredIds = new Set((answeredRows ?? []).map((r) => r.question_id as string))
  const pool = (activeRows ?? []).filter((q) => !answeredIds.has(q.id))
  return selectEligibleQuestions(pool, 3)
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
  /** Admin Phase 2A-1 — 'hidden' only ever reaches the CALLER when the
   * caller is this answer's own author (question_answers' self-select
   * RLS policy; every other viewer's row is excluded entirely before
   * this ever runs). The owner's own profile view renders "Hidden by
   * TEMPA" for it instead of the normal answer card. */
  moderationStatus: 'visible' | 'hidden'
}

/**
 * Pure: pairs a member's raw question_answers rows with the prompt of
 * the Question each belongs to. Unlike the old buildCanonicalAnswers,
 * this does NOT filter by canonical/slug membership at all — a
 * member's answer to ANY Question in the library is real, historical
 * content of theirs and is always included here, regardless of whether
 * that Question is still active or was ever "canonical." The only row
 * ever dropped is one whose parent Question can't be resolved at all
 * (e.g. `questionsById` wasn't given it) — which in practice never
 * happens, since a Question can never be hard-deleted while it still
 * has answers (see admin_replace_question/admin_create_question —
 * neither RPC nor any other code path deletes a questions row).
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
  questionsById: Map<string, { prompt: string }>
): MyQuestionAnswer[] {
  return answerRows
    .filter((row) => questionsById.has(row.question_id))
    .map((row) => ({
      id: row.id,
      questionId: row.question_id,
      prompt: questionsById.get(row.question_id)!.prompt,
      body: row.body,
      updatedAt: row.updated_at,
      isCurrent: row.is_current,
      moderationStatus: row.moderation_status,
    }))
}

/**
 * Every Question-answer this member has ever written, to ANY Question
 * in the library — "My answers" own history, complete, regardless of
 * whether the underlying Question is still active. This replaces
 * getCanonicalAnswers + getAllCanonicalQuestions' old combination: a
 * historical answer to a since-deactivated (or since-replaced) Question
 * keeps showing here exactly as it did before, with no separate
 * "resolve the full canonical set first" step needed, because nothing
 * here is scoped to a small fixed set to begin with.
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
    .select('id, prompt')
    .in('id', questionIds)

  const questionsById = new Map((questionRows ?? []).map((q) => [q.id, { prompt: q.prompt }]))
  return buildMyAnswers(answerRows, questionsById)
}

/**
 * Pure: whichever eligible Question comes first, excluding the one the
 * member just answered/is currently viewing. Replaces the old fixed-
 * order-with-wraparound nextUnansweredCanonicalQuestion — with a real,
 * growable library the notion of "next in canonical order" no longer
 * applies; `eligible` (from getEligibleQuestions, already unanswered +
 * active + family-diverse) is itself the candidate set, so this is
 * just "the first one that isn't the current page's own Question."
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
 * any navigation (see app/minds/page.tsx, app/minds/[userId]/page.tsx,
 * app/write/[recipientId]/page.tsx) — it now drives only the non-
 * blocking "Answer a Question" indicator on /minds (the dot on its
 * tab, and QuestionIncompleteNotice). Browsing Minds, opening a
 * profile, reading a published answer, and starting a first letter are
 * never blocked by this being true.
 */
export function needsParticipationGate(
  eligibleQuestionCount: number,
  completedAnswerCount: number
): boolean {
  if (eligibleQuestionCount === 0 && completedAnswerCount === 0) return false
  return completedAnswerCount === 0
}

/**
 * Pure: the save-confirmation copy for a Question answer, distinguishing
 * "this specific save just became the member's featured (Shown in
 * Minds) answer" from an ordinary save. Never conflates saving a
 * Question answer with sending a letter — there is no recipient, no
 * correspondence, and no Mail Call involved in either case, only
 * publish_question_answer's own is_current promotion rule: a member's
 * first-ever answer (to ANY active Question, since the Question
 * source-of-truth correction) is auto-featured; every later save
 * leaves an existing featured answer alone. `wasCurrent` is the
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

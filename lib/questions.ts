import type { SupabaseClient } from '@supabase/supabase-js'

export type ActiveQuestion = {
  id: string
  prompt: string
}

export const CANONICAL_QUESTION_SLUGS = [
  'private_ritual',
  'place_outsiders_miss',
  'ordinary_worth_protecting',
] as const

export type CanonicalSlug = (typeof CANONICAL_QUESTION_SLUGS)[number]
export const QUESTION_ANSWER_MAX_CHARS = 2000
export type QuestionPosition = 1 | 2 | 3

export type LibraryQuestion = {
  id: string
  prompt: string
  position: QuestionPosition
}

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

/** The one editorially-selected, active non-Flagship Question for The Room. */
export async function getCurrentRoomQuestion(
  supabase: SupabaseClient
): Promise<{ id: string; prompt: string } | null> {
  const { data } = await supabase
    .from('questions')
    .select('id, prompt')
    .eq('is_active', true)
    .eq('is_flagship', false)
    .not('current_position', 'is', null)
    .order('current_position', { ascending: true })
    .limit(1)
    .maybeSingle()

  return data ? { id: data.id, prompt: data.prompt } : null
}

export type QuestionAnswerEncounter = {
  answerId: string
  userId: string
  pseudonym: string
  country: string | null
  markId: string | null
  body: string
}

/**
 * A bounded, writing-first set of people who actually answered one Question.
 * Visibility is still constrained by question_answers/public_profiles RLS.
 * `excludeUserIds` is a presentation dedupe hint, never a security boundary.
 */
export async function getQuestionAnswerEncounters(
  supabase: SupabaseClient,
  questionId: string,
  viewerId: string,
  options: { excludeUserIds?: string[]; limit?: number } = {}
): Promise<QuestionAnswerEncounter[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 3), 12)
  const fetchLimit = Math.min(Math.max(limit * 4, 12), 48)
  const excluded = new Set([viewerId, ...(options.excludeUserIds ?? [])])

  const { data: answerRows } = await supabase
    .from('question_answers')
    .select('id, user_id, body, updated_at')
    .eq('question_id', questionId)
    .eq('moderation_status', 'visible')
    .neq('user_id', viewerId)
    .order('updated_at', { ascending: false })
    .limit(fetchLimit)

  if (!answerRows || answerRows.length === 0) return []

  const distinctRows: typeof answerRows = []
  const seenUsers = new Set<string>()
  for (const row of answerRows) {
    if (excluded.has(row.user_id) || seenUsers.has(row.user_id)) continue
    seenUsers.add(row.user_id)
    distinctRows.push(row)
  }
  if (distinctRows.length === 0) return []

  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, pseudonym, country, mark_id')
    .in('id', distinctRows.map((row) => row.user_id))

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile as { id: string; pseudonym: string; country: string | null; mark_id: string | null }])
  )

  const encounters: QuestionAnswerEncounter[] = []
  for (const row of distinctRows) {
    const profile = profileById.get(row.user_id)
    if (!profile) continue
    encounters.push({
      answerId: row.id,
      userId: row.user_id,
      pseudonym: profile.pseudonym,
      country: profile.country,
      markId: profile.mark_id,
      body: row.body,
    })
    if (encounters.length >= limit) break
  }
  return encounters
}

export type PrimaryAnswer = {
  id: string
  questionId: string
  prompt: string
  body: string
  updatedAt: string
}

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
  id: string
  questionId: string
  prompt: string
  body: string
  updatedAt: string
  isCurrent: boolean
  isPrimary: boolean
  moderationStatus: 'visible' | 'hidden'
}

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

export function nextEligibleQuestion(
  eligible: LibraryQuestion[],
  currentQuestionId: string
): LibraryQuestion | null {
  return eligible.find((q) => q.id !== currentQuestionId) ?? null
}

export function needsParticipationGate(
  eligibleQuestionCount: number,
  completedAnswerCount: number
): boolean {
  if (eligibleQuestionCount === 0 && completedAnswerCount === 0) return false
  return completedAnswerCount === 0
}

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

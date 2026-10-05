import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryCandidate } from './discovery'

type HomeRoomRow = {
  answer_id: string
  user_id: string
  body: string
  pseudonym: string
  country: string | null
  gender: string | null
  gender_custom: string | null
  age_range: string | null
  mark_id: string | null
  prompt: string
}

function noveltyScore(candidate: DiscoveryCandidate, selected: DiscoveryCandidate[]) {
  if (selected.length === 0) return 0

  const countries = new Set(selected.map((entry) => entry.country).filter(Boolean))
  const genders = new Set(selected.map((entry) => entry.gender).filter(Boolean))
  const ages = new Set(selected.map((entry) => entry.ageRange).filter(Boolean))

  return (
    (!candidate.country || countries.has(candidate.country) ? 0 : 3) +
    (!candidate.gender || genders.has(candidate.gender) ? 0 : 2) +
    (!candidate.ageRange || ages.has(candidate.ageRange) ? 0 : 1)
  )
}

/**
 * Select three perspectives from a small fairness-ranked candidate window.
 * Fairness still defines the pool and tie order; diversity only chooses among
 * that bounded front-of-pool set so Home does not become a popularity or
 * demographic-ranking surface.
 */
export function selectThreePerspectives(
  candidates: DiscoveryCandidate[],
  limit = 3
): DiscoveryCandidate[] {
  const pool = [...candidates]
  const selected: DiscoveryCandidate[] = []

  while (pool.length > 0 && selected.length < limit) {
    let bestIndex = 0
    let bestScore = noveltyScore(pool[0], selected)

    for (let index = 1; index < pool.length; index += 1) {
      const score = noveltyScore(pool[index], selected)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    selected.push(pool.splice(bestIndex, 1)[0])
  }

  return selected
}

/**
 * Home's Three Perspectives comes from the same fair current-Question pool as
 * The Room. We ask for a bounded six-person window, then select three varied
 * perspectives from that window. Reading history never removes an answer and
 * current capacity never closes the public reading surface.
 */
export async function getHomeQuestionAnswers(
  client: SupabaseClient,
  viewerId: string,
  question: { id: string; prompt: string }
): Promise<DiscoveryCandidate[]> {
  void viewerId

  const { data, error } = await client.rpc('room_read_question_answer_batch', {
    p_question_id: question.id,
    p_exclude_user_ids: [],
    p_limit: 6,
    p_country: null,
    p_gender: null,
    p_age: null,
  })

  if (error || !Array.isArray(data)) return []

  const candidates = (data as HomeRoomRow[])
    .slice(0, 6)
    .map((row) => ({
      answerId: row.answer_id,
      userId: row.user_id,
      pseudonym: row.pseudonym,
      country: row.country ?? '',
      gender: row.gender,
      genderCustom: row.gender_custom,
      ageRange: row.age_range ?? '',
      markId: row.mark_id,
      body: row.body,
      prompt: row.prompt || question.prompt,
    }))

  return selectThreePerspectives(candidates, 3)
}

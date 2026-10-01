import type { SupabaseClient } from '@supabase/supabase-js'

// Room discovery stays bounded inside Postgres. V2 adds fair-exposure ranking,
// current-Question preference, Question-focused browsing and Home author
// exclusions while preserving the old RPC as a rollout fallback for ordinary
// Read the Room browsing until the forward migration is applied in production.

export const DISCOVERY_BATCH_SIZE = 6
export const MAX_DISCOVERY_LIMIT = 24

export type DiscoverySurface = 'home_room' | 'room' | 'room_question'

export type DiscoveryCandidate = {
  userId: string
  pseudonym: string
  country: string
  gender: string | null
  genderCustom: string | null
  ageRange: string
  markId: string | null
  answerId: string
  body: string
  prompt: string
  languages?: string[]
  intent?: string[]
}

export type DiscoveryPage = {
  candidates: DiscoveryCandidate[]
  eligibleCount: number
  filteredCount: number
  /** False only when V2 was requested but is unavailable and a legacy fallback was used. */
  fairRankingApplied: boolean
  browseStartedAt: string | null
  unavailable?: boolean
}

export type DiscoveryRequest = {
  language?: string
  intent?: string
  search?: string
  profileLed?: boolean
  country?: string
  gender?: string
  ageRange?: string
  questionId?: string
  browseStartedAt?: string
  excludeUserIds?: string[]
  offset?: number
  limit?: number
}

type RpcEntry = {
  user_id: string
  pseudonym: string
  country: string
  gender: string | null
  gender_custom: string | null
  age_range: string
  mark_id: string | null
  answer_id: string
  body: string
  prompt: string | null
  languages?: string[]
  intent?: string[]
}

type RpcResult = {
  browse_started_at?: string
  eligible_count?: number
  filtered_count?: number
  entries?: RpcEntry[]
}

const EMPTY: DiscoveryPage = { candidates: [], eligibleCount: 0, filteredCount: 0, fairRankingApplied: false, browseStartedAt: null }

function mapRpcResult(data: unknown, limit: number, fairRankingApplied: boolean): DiscoveryPage {
  const result = data as RpcResult
  const seen = new Set<string>()
  const candidates: DiscoveryCandidate[] = []
  for (const entry of result.entries ?? []) {
    if (seen.has(entry.user_id)) continue
    seen.add(entry.user_id)
    candidates.push({
      userId: entry.user_id,
      pseudonym: entry.pseudonym,
      country: entry.country,
      gender: entry.gender,
      genderCustom: entry.gender_custom,
      ageRange: entry.age_range,
      markId: entry.mark_id,
      answerId: entry.answer_id,
      body: entry.body,
      prompt: entry.prompt ?? '',
      ...(entry.languages ? { languages: entry.languages } : {}),
      ...(entry.intent ? { intent: entry.intent } : {}),
    })
    if (candidates.length === limit) break
  }
  return {
    candidates,
    eligibleCount: Number(result.eligible_count ?? 0),
    filteredCount: Number(result.filtered_count ?? 0),
    fairRankingApplied,
    browseStartedAt: fairRankingApplied ? result.browse_started_at ?? null : null,
  }
}

export async function getDiscoveryPage(supabase: SupabaseClient, request: DiscoveryRequest = {}): Promise<DiscoveryPage> {
  const limit = Math.min(Math.max(1, Math.floor(Number.isFinite(request.limit) ? request.limit! : DISCOVERY_BATCH_SIZE)), MAX_DISCOVERY_LIMIT)
  const offset = Math.min(Math.max(0, Math.floor(Number.isFinite(request.offset) ? request.offset! : 0)), 2147483647)

  // Profile-led search/filtering is performed inside Postgres under the
  // caller's RLS context, never by downloading the profile population.
  if (request.profileLed || request.language || request.intent || request.search) {
    const { data, error } = await supabase.rpc('discover_profiles', {
      p_country: request.country || null, p_gender: request.gender || null,
      p_age_range: request.ageRange || null, p_language: request.language || null,
      p_intent: request.intent || null, p_search: request.search || null,
      p_exclude_user_ids: request.excludeUserIds ?? [], p_limit: limit,
    })
    return error || !data ? { ...EMPTY, unavailable: true } : mapRpcResult(data, limit, true)
  }

  const { data: v2Data, error: v2Error } = await supabase.rpc('discover_people_v2', {
    p_country: request.country || null,
    p_gender: request.gender || null,
    p_age_range: request.ageRange || null,
    p_question_id: request.questionId || null,
    p_exclude_user_ids: request.excludeUserIds ?? [],
    p_offset: offset,
    p_limit: limit,
    p_browse_started_at: request.browseStartedAt || null,
  })

  if (!v2Error && v2Data) return mapRpcResult(v2Data, limit, true)

  // A Question-focused result must never silently degrade into generic people,
  // because Home/Room would then label unrelated writing as answers to the live
  // Question. Before V2 exists, fail closed for that narrow surface only.
  if (request.questionId) return EMPTY

  const { data, error } = await supabase.rpc('discover_people', {
    p_country: request.country || null,
    p_gender: request.gender || null,
    p_age_range: request.ageRange || null,
    p_offset: offset,
    p_limit: limit,
  })
  if (error || !data) return EMPTY
  return mapRpcResult(data, limit, false)
}

export function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

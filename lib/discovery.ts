import type { SupabaseClient } from '@supabase/supabase-js'

// People discovery — ONE bounded primitive shared by People (app/minds)
// and Home's Recommended minds. Candidate selection, Safety/block
// visibility, exclusions, filters, per-viewer ordering and pagination all
// run inside Postgres (public.discover_people — see docs/sql/2026-10-13-
// prelaunch-performance.sql), under the member's own session. Next.js
// only ever receives the requested page (at most MAX_DISCOVERY_LIMIT
// rows) plus two counts, never the member population.

export const DISCOVERY_BATCH_SIZE = 6
/** Mirrors the clamp inside discover_people itself. */
export const MAX_DISCOVERY_LIMIT = 24

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
}

export type DiscoveryPage = {
  candidates: DiscoveryCandidate[]
  /** Everyone discoverable to this viewer, before filters. */
  eligibleCount: number
  /** Everyone matching the requested filters. */
  filteredCount: number
}

export type DiscoveryRequest = {
  country?: string
  gender?: string
  ageRange?: string
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
}

type RpcResult = {
  eligible_count?: number
  filtered_count?: number
  entries?: RpcEntry[]
}

const EMPTY: DiscoveryPage = { candidates: [], eligibleCount: 0, filteredCount: 0 }

export async function getDiscoveryPage(supabase: SupabaseClient, request: DiscoveryRequest = {}): Promise<DiscoveryPage> {
  const limit = Math.min(Math.max(1, Math.floor(request.limit ?? DISCOVERY_BATCH_SIZE)), MAX_DISCOVERY_LIMIT)
  const offset = Math.min(Math.max(0, Math.floor(request.offset ?? 0)), 2147483647) // int4 argument

  const { data, error } = await supabase.rpc('discover_people', {
    p_country: request.country || null,
    p_gender: request.gender || null,
    p_age_range: request.ageRange || null,
    p_offset: offset,
    p_limit: limit,
  })
  if (error || !data) return EMPTY

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
    })
    if (candidates.length === limit) break
  }

  return {
    candidates,
    eligibleCount: Number(result.eligible_count ?? 0),
    filteredCount: Number(result.filtered_count ?? 0),
  }
}

export function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

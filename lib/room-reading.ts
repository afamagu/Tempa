import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryCandidate } from './discovery'
import { discoveryEntries } from './discovery-entries'

export type RoomQuestion = { id: string; prompt: string; published_at: string | null; is_current: boolean; is_flagship: boolean }
export type RoomCursor = { createdAt: string; answerId: string }
export type RoomFilters = { country?: string; gender?: string; age?: string }

export async function readRoomAnswers(client: SupabaseClient, questionId: string, filters: RoomFilters = {}, cursor: RoomCursor | null = null, limit = 3) {
  const size = Math.min(Math.max(limit, 1), 12)
  const { data, error } = await client.rpc('room_read_question_answers', {
    p_question_id: questionId, p_after_created_at: cursor?.createdAt ?? null,
    p_after_id: cursor?.answerId ?? null, p_limit: size,
    p_country: filters.country ?? null, p_gender: filters.gender ?? null, p_age: filters.age ?? null,
  })
  type Row = { answer_id: string; user_id: string; body: string; created_at: string; pseudonym: string; country: string | null; gender: string | null; gender_custom: string | null; age_range: string | null; mark_id: string | null; prompt: string }
  if (error) return { entries: [], cursor, hasMore: false, error: 'Could not load these answers. Please try again.' }
  const rows = (data ?? []) as Row[]
  const page = rows.slice(0, size)
  const candidates: DiscoveryCandidate[] = page.map(r => ({ answerId: r.answer_id, userId: r.user_id, body: r.body, pseudonym: r.pseudonym, country: r.country ?? '', gender: r.gender, genderCustom: r.gender_custom, ageRange: r.age_range ?? '', markId: r.mark_id, prompt: r.prompt }))
  const last = page.at(-1)
  return { entries: await discoveryEntries(client, candidates), cursor: last ? { createdAt: last.created_at, answerId: last.answer_id } : cursor, hasMore: rows.length > size, error: null }
}

export async function readRoomLibrary(client: SupabaseClient, search = '', offset = 0, limit = 6, dates: { from?: string; to?: string } = {}) {
  const { data, error } = await client.rpc('room_question_library', { p_search: search.slice(0, 100), p_offset: offset, p_limit: limit, p_from: dates.from ?? null, p_to: dates.to ?? null })
  const rows = (data ?? []) as RoomQuestion[]
  return { questions: rows.slice(0, limit), hasMore: rows.length > limit, error: error ? 'Could not load the question library. Please try again.' : null }
}

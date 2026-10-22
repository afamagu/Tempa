import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchExcerpt } from './dispatches'
import { publicProfileMarkUrl } from './profile-marks'

export const DIRECTORY_PAGE_SIZE = 6

export type DirectoryFilters = {
  country?: string
  language?: string
  search?: string
  gender?: string
  age?: string
  intent?: string
  interest?: string
  /** Members with no shared writing appear when All Members is selected. */
  letters?: 'all'
}

export type DirectoryPerson = {
  userId: string
  pseudonym: string
  country: string
  markUrl: string | null
  languages: string[]
  latestLetter: { id: string; title: string; excerpt: string } | null
  introduction?: { id: string; excerpt: string } | null
}

export type DirectoryPage = {
  entries: DirectoryPerson[]
  hasMore: boolean
  error: string | null
}

type RpcPerson = {
  user_id: string
  pseudonym: string
  country?: string | null
  mark_id?: string | null
  languages?: string[] | null
  latest_letter_id?: string | null
  latest_letter_title?: string | null
  latest_letter_body?: string | null
  introduction_answer_id?: string | null
  introduction_body?: string | null
}
type RpcResult = { entries?: RpcPerson[]; has_more?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The server is responsible for the immutable six-person boundary.
 * The RPC independently checks account visibility, bilateral blocks,
 * moderated/published member writing and cursor order. Only the dedicated,
 * explicitly visible profile-introduction Question answer is eligible; no other Question answers,
 * online status, matching scores, or popularity calculations.
 */
export async function getRoomDirectoryPage(
  supabase: SupabaseClient,
  filters: DirectoryFilters,
  seed: string,
  afterUserId: string | null = null,
): Promise<DirectoryPage> {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(seed) || (afterUserId && !UUID.test(afterUserId))) {
    return { entries: [], hasMore: false, error: 'Invalid directory request.' }
  }
  const { data, error } = await supabase.rpc('discover_room_writers', {
    p_country: filters.country?.slice(0, 100) || null,
    p_language: filters.language?.slice(0, 100) || null,
    p_search: filters.search?.slice(0, 80) || null,
    p_gender: filters.gender?.slice(0, 100) || null,
    p_age_range: filters.age?.slice(0, 20) || null,
    p_intent: filters.intent?.slice(0, 100) || null,
    p_interest: filters.interest?.slice(0, 100) || null,
    p_has_letter: filters.letters !== 'all',
    p_seed: seed,
    p_after_user_id: afterUserId,
    p_limit: DIRECTORY_PAGE_SIZE,
  })

  if (error || !data || !Array.isArray((data as RpcResult).entries)) {
    console.error('[directory] unable to retrieve Room writers', {
      code: error?.code,
      message: error?.message,
    })
    return { entries: [], hasMore: false, error: 'Could not load people right now. Please try again.' }
  }

  const seen = new Set<string>()
  const entries: DirectoryPerson[] = []
  for (const row of (data as RpcResult).entries ?? []) {
    if (!UUID.test(row.user_id) || seen.has(row.user_id)) continue
    seen.add(row.user_id)
    entries.push({
      userId: row.user_id,
      pseudonym: row.pseudonym,
      country: row.country ?? '',
      markUrl: row.mark_id ? publicProfileMarkUrl(supabase, `${row.mark_id}.png`) : null,
      languages: row.languages ?? [],
      introduction: row.introduction_answer_id && row.introduction_body
        ? { id: row.introduction_answer_id, excerpt: row.introduction_body.slice(0, 190) }
        : null,
      latestLetter: row.latest_letter_id && row.latest_letter_title && row.latest_letter_body
        ? { id: row.latest_letter_id, title: row.latest_letter_title, excerpt: dispatchExcerpt(row.latest_letter_body).slice(0, 190) }
        : null,
    })
  }
  return { entries: entries.slice(0, DIRECTORY_PAGE_SIZE), hasMore: Boolean((data as RpcResult).has_more), error: null }
}

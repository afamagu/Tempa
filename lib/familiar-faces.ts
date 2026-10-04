import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { discoveryEntries } from './discovery-entries'
import type { DiscoveryEntry } from '@/app/room/discovery-results'

type FamiliarFaceRow = {
  candidate_id: string
  pseudonym: string
  country: string | null
  gender: string | null
  gender_custom: string | null
  age_range: string | null
  mark_id: string | null
  languages: string[] | null
  intent: string[] | null
  answer_id: string
  prompt: string | null
  body: string
}

export async function getFamiliarFaces(
  supabase: SupabaseClient,
  limit = 3
): Promise<DiscoveryEntry[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 3)
  const { data, error } = await supabase.rpc('get_familiar_faces', { p_limit: boundedLimit })

  // The migration is forward-only and may not have reached a particular
  // environment yet. Familiar Faces is ambient: failure must never break Home
  // or the Room while the database remains the authority.
  if (error || !Array.isArray(data)) {
    if (error) {
      console.error('[familiar-faces] get_familiar_faces failed', {
        message: error.message,
        code: error.code,
      })
    }
    return []
  }

  return discoveryEntries(
    supabase,
    (data as FamiliarFaceRow[]).map((row) => ({
      userId: row.candidate_id,
      pseudonym: row.pseudonym,
      country: row.country ?? '',
      gender: row.gender,
      genderCustom: row.gender_custom,
      ageRange: row.age_range ?? '',
      markId: row.mark_id,
      answerId: row.answer_id,
      body: row.body,
      prompt: row.prompt ?? '',
      languages: row.languages ?? [],
      intent: row.intent ?? [],
    }))
  )
}

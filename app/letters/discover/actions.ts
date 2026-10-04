'use server'

import { createClient } from '@/lib/supabase/server'
import { discoveryEntries } from '@/lib/discovery-entries'
import { getRelationshipCapacity } from '@/lib/relationship-capacity'
import type { DiscoveryEntry } from '@/app/room/discovery-results'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type IntroductionRow = {
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

function toDiscoveryCandidate(row: IntroductionRow) {
  return {
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
  }
}

export async function loadPassiveIntroductions(): Promise<{
  entries: DiscoveryEntry[]
  error: 'signIn' | 'failed' | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { entries: [], error: 'signIn' }

  const capacity = await getRelationshipCapacity(supabase)
  if (capacity?.canStartFirstContact === false) return { entries: [], error: null }

  const { data, error } = await supabase.rpc('get_member_introductions', { p_limit: 6 })
  if (error || !Array.isArray(data)) {
    if (error) {
      console.error('[discover] get_member_introductions failed', {
        message: error.message,
        code: error.code,
      })
    }
    return { entries: [], error: 'failed' }
  }

  const entries = await discoveryEntries(
    supabase,
    (data as IntroductionRow[]).map(toDiscoveryCandidate)
  )
  return { entries: entries.slice(0, 6), error: null }
}

export async function markPassiveIntroductionPresented(candidateId: string): Promise<void> {
  if (typeof candidateId !== 'string' || !UUID.test(candidateId)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id === candidateId) return

  const { error } = await supabase.rpc('mark_member_introduction_presented', {
    p_candidate_id: candidateId,
  })
  if (error) {
    console.error('[discover] mark_member_introduction_presented failed', {
      message: error.message,
      code: error.code,
    })
  }
}

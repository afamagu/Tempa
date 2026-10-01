import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { genderDisplay, type DiscoveryCandidate } from './discovery'
import { getMemberWritingStyles } from './writing-style-data'
import { editorialTitleFor, getEditorialBylines } from './editorial-byline'
import { publicProfileMarkUrl } from './profile-marks'
import type { DiscoveryEntry } from '@/app/room/discovery-results'

export async function discoveryEntries(supabase: SupabaseClient, page: DiscoveryCandidate[]): Promise<DiscoveryEntry[]> {
  const [styles, bylines] = await Promise.all([
    getMemberWritingStyles(supabase, page.map((candidate) => candidate.userId)),
    getEditorialBylines(supabase),
  ])
  return page.map((candidate) => ({
    userId: candidate.userId, pseudonym: candidate.pseudonym, country: candidate.country,
    genderDisplay: genderDisplay(candidate.gender, candidate.genderCustom), ageRange: candidate.ageRange,
    markUrl: candidate.markId ? publicProfileMarkUrl(supabase, `${candidate.markId}.png`) : null,
    response: { id: candidate.answerId, body: candidate.body, prompt: candidate.prompt },
    editorialTitle: editorialTitleFor(bylines, candidate.pseudonym),
    writingStyleId: styles.get(candidate.userId) ?? null,
    languages: candidate.languages ?? [], intent: candidate.intent ?? [],
  }))
}

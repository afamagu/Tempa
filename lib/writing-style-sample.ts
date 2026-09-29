import type { SupabaseClient } from '@supabase/supabase-js'
import { getMyAnswers } from './questions'
import { getPublishedDispatchesByAuthor } from './dispatches'
import { parseFormattedText, stripRichBodyMarker } from './letter-editor-doc'
import { previewExcerpt, WRITING_STYLE_FALLBACK_SAMPLE } from './writing-style'

export type WritingSampleSource = 'flagship' | 'response' | 'dispatch' | 'fallback'

export type WritingSample = { text: string; source: WritingSampleSource }

/** Longest excerpt the chooser's larger preview shows. */
export const WRITING_SAMPLE_MAX_CHARS = 640

/** Plain words of a stored body — bold/italic markup removed, never shown
 *  as literal asterisks in a preview. */
export function plainWords(body: string): string {
  const { isRich, body: clean } = stripRichBodyMarker(body)
  if (!isRich) return clean
  return clean
    .split('\n')
    .map((line) => parseFormattedText(line).map((s) => s.text).join(''))
    .join('\n')
}

/**
 * The member's OWN words for the six-style preview: their Flagship
 * response (just written, for a new member), else their most recent
 * other response, else their latest published Dispatch. Only a member who
 * has genuinely written nothing sees Tempa's restrained fallback.
 */
export async function getWritingSample(supabase: SupabaseClient, userId: string): Promise<WritingSample> {
  const answers = (await getMyAnswers(supabase, userId).catch(() => [])).filter(
    (a) => a.moderationStatus !== 'hidden' && a.body.trim().length > 0
  )
  const flagship = answers.find((a) => a.isPrimary)
  if (flagship) {
    const text = previewExcerpt(flagship.body, WRITING_SAMPLE_MAX_CHARS)
    if (text) return { text, source: 'flagship' }
  }
  const latest = [...answers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (latest) {
    const text = previewExcerpt(latest.body, WRITING_SAMPLE_MAX_CHARS)
    if (text) return { text, source: 'response' }
  }

  const dispatches = await getPublishedDispatchesByAuthor(supabase, userId).catch(() => [])
  for (const dispatch of dispatches) {
    const text = previewExcerpt(plainWords(dispatch.body), WRITING_SAMPLE_MAX_CHARS)
    if (text) return { text, source: 'dispatch' }
  }

  return { text: WRITING_STYLE_FALLBACK_SAMPLE, source: 'fallback' }
}

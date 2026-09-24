import type { SupabaseClient } from '@supabase/supabase-js'

// Automatic reading resume for long-form content. There is deliberately
// no member-managed bookmark/ribbon state here: the product remembers
// where the member stopped in the background and restores that position
// on the next visit.

export type ContentType = 'letter' | 'dispatch'

export type ReadingPlaceState = {
  resumeParagraphIndex: number | null
  resumeCharOffset: number | null
  resumeUpdatedAt: string | null
}

const EMPTY_STATE: ReadingPlaceState = {
  resumeParagraphIndex: null,
  resumeCharOffset: null,
  resumeUpdatedAt: null,
}

export function clampReadingPosition(storedIndex: number | null, paragraphCount: number): number {
  if (paragraphCount <= 0 || storedIndex === null) return 0
  return Math.min(Math.max(storedIndex, 0), paragraphCount - 1)
}

export function estimateCharOffset(fraction: number, paragraphLength: number): number {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  return Math.round(clamped * paragraphLength)
}

export function estimateScrollFraction(charOffset: number, paragraphLength: number): number {
  if (paragraphLength <= 0) return 0
  return Math.min(Math.max(charOffset / paragraphLength, 0), 1)
}

export type MeasuredParagraph = {
  index: number
  top: number
  height: number
  textLength: number
}

/** Fresh snapshot of the current reading position. It intentionally has
 * no "furthest ever" memory, so scrolling back up before leaving moves
 * the resume point back up too. */
export function pickCurrentParagraph(
  paragraphs: MeasuredParagraph[]
): { paragraphIndex: number; charOffset: number | null } | null {
  let current: MeasuredParagraph | null = null
  for (const paragraph of paragraphs) {
    if (paragraph.top < 0 && (!current || paragraph.index > current.index)) {
      current = paragraph
    }
  }
  if (!current) return null

  const charOffset =
    current.textLength > 0 && current.height > 0
      ? estimateCharOffset(-current.top / current.height, current.textLength)
      : null

  return { paragraphIndex: current.index, charOffset }
}

export async function getReadingPlaceState(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string
): Promise<ReadingPlaceState> {
  const { data, error } = await supabase
    .from('reading_places')
    .select('resume_paragraph_index, resume_char_offset, resume_updated_at')
    .eq('user_id', userId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .maybeSingle()

  if (error) {
    console.error('[reading-places] getReadingPlaceState failed, degrading to empty state', {
      message: error.message,
      contentType,
      contentId,
    })
    return EMPTY_STATE
  }

  if (!data) return EMPTY_STATE

  return {
    resumeParagraphIndex: data.resume_paragraph_index as number | null,
    resumeCharOffset: data.resume_char_offset as number | null,
    resumeUpdatedAt: data.resume_updated_at as string | null,
  }
}

/** Background-only progress write. Failure is logged but never interrupts
 * reading or presents a user-facing error; the next visit simply starts
 * from the last position that did persist. */
export async function recordReadingProgress(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string,
  paragraphIndex: number,
  charOffset: number | null = null
): Promise<void> {
  const { error } = await supabase.from('reading_places').upsert({
    user_id: userId,
    content_type: contentType,
    content_id: contentId,
    resume_paragraph_index: paragraphIndex,
    resume_char_offset: charOffset,
    resume_updated_at: new Date().toISOString(),
  })

  if (error) {
    console.error('[reading-places] recordReadingProgress failed (automatic tracking only)', {
      message: error.message,
      contentType,
      contentId,
    })
  }
}

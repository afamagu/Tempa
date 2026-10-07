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

export type CachedReadingPlace = {
  paragraphIndex: number
  charOffset: number | null
  updatedAt: number
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
  if (!current) {
    const firstVisible = paragraphs
      .filter((paragraph) => paragraph.top + paragraph.height > 0)
      .sort((a, b) => a.top - b.top)[0]
    if (!firstVisible) return null
    return { paragraphIndex: firstVisible.index, charOffset: 0 }
  }

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


function readingCacheKey(userId: string, contentType: ContentType, contentId: string): string {
  return `tempa-reading-place:${userId}:${contentType}:${contentId}`
}

/**
 * Fast same-device resume. The server row remains canonical cross-device
 * storage; this cache exists only so reopening a long letter never waits on
 * network latency before returning to the place the reader just left.
 */
export function readCachedReadingPlace(
  userId: string,
  contentType: ContentType,
  contentId: string
): CachedReadingPlace | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(readingCacheKey(userId, contentType, contentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedReadingPlace>
    if (
      !Number.isInteger(parsed.paragraphIndex) ||
      (parsed.charOffset !== null && parsed.charOffset !== undefined && !Number.isInteger(parsed.charOffset)) ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return null
    }
    return {
      paragraphIndex: Math.max(0, parsed.paragraphIndex as number),
      charOffset: parsed.charOffset == null ? null : Math.max(0, parsed.charOffset),
      updatedAt: parsed.updatedAt,
    }
  } catch {
    return null
  }
}

export function writeCachedReadingPlace(
  userId: string,
  contentType: ContentType,
  contentId: string,
  paragraphIndex: number,
  charOffset: number | null
): CachedReadingPlace {
  const value: CachedReadingPlace = {
    paragraphIndex: Math.max(0, paragraphIndex),
    charOffset: charOffset === null ? null : Math.max(0, charOffset),
    updatedAt: Date.now(),
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(readingCacheKey(userId, contentType, contentId), JSON.stringify(value))
    } catch {
      // Same fail-soft policy as draft persistence: server sync still works.
    }
  }
  return value
}

export function serverReadingPlaceTimestamp(state: ReadingPlaceState): number {
  if (!state.resumeUpdatedAt) return 0
  const parsed = Date.parse(state.resumeUpdatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

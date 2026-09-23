import type { SupabaseClient } from '@supabase/supabase-js'

// Reading Places — automatic resume + deliberate Saved place, shared
// across Letters and Dispatches (docs/sql/2026-10-04-reading-places.sql).
// Deliberately unrelated to Safety 2 — a separate, independently
// authorized product feature, not part of that checkpoint sequence.
//
// Mirrors lib/dispatches.ts's own "VIEWED / RESUME STATE" section
// (clampReadingPosition/recordDispatchProgress/getDispatchViewState)
// in spirit, generalized over content_type, and DELIBERATELY does not
// touch dispatch_views — that table remains Dispatches' own, already-
// shipped automatic-resume mechanism; see the migration's own header
// comment for why. This module covers: Letters' automatic resume (new),
// and BOTH content types' deliberate Saved place (new).
//
// The anchor unit is a paragraph INDEX within the marker-stripped,
// splitParagraphs-split body — the same unit dispatch_views already
// uses, and the only naturally stable unit either a Letter or a
// Dispatch body has (both are a single plain `text` column; there is
// no per-paragraph id or character-offset infrastructure anywhere in
// this codebase). See clampReadingPosition below for the recovery
// strategy when a stored index no longer fits the content's current
// paragraph count.

export type ContentType = 'letter' | 'dispatch'

export type ReadingPlaceState = {
  /** Automatic resume — silently tracked, never a member action. Null
   * until the member has read any of this content. */
  resumeParagraphIndex: number | null
  resumeUpdatedAt: string | null
  /** Deliberate Saved place — set only by an explicit "Save my place"/
   * "Move my place" action. Null until the member has saved a place in
   * this content. At most one per (member, content item) by
   * construction — saving again overwrites these same two fields
   * rather than adding a row. */
  savedParagraphIndex: number | null
  savedAt: string | null
}

const EMPTY_STATE: ReadingPlaceState = {
  resumeParagraphIndex: null,
  resumeUpdatedAt: null,
  savedParagraphIndex: null,
  savedAt: null,
}

/** Pure: never restores to a paragraph that no longer exists — the
 * reader always has somewhere valid to land, even if a stored position
 * from before is now out of range. A null stored index (never recorded)
 * clamps to the very start, same as an out-of-range one. */
export function clampReadingPosition(storedIndex: number | null, paragraphCount: number): number {
  if (paragraphCount <= 0 || storedIndex === null) return 0
  return Math.min(Math.max(storedIndex, 0), paragraphCount - 1)
}

/** The stored reading state for one (member, content item) pair, or
 * `EMPTY_STATE` shape (all nulls) if no row exists yet — callers never
 * need to separately branch on "row exists at all". */
export async function getReadingPlaceState(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string
): Promise<ReadingPlaceState> {
  const { data } = await supabase
    .from('reading_places')
    .select('resume_paragraph_index, resume_updated_at, saved_paragraph_index, saved_at')
    .eq('user_id', userId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .maybeSingle()

  if (!data) return EMPTY_STATE

  return {
    resumeParagraphIndex: data.resume_paragraph_index as number | null,
    resumeUpdatedAt: data.resume_updated_at as string | null,
    savedParagraphIndex: data.saved_paragraph_index as number | null,
    savedAt: data.saved_at as string | null,
  }
}

/** Silently records automatic reading progress — no Save action
 * anywhere calls this; the reader itself calls it as the member reads.
 * Touches ONLY resume_paragraph_index/resume_updated_at — a plain
 * Supabase upsert only updates the columns it's given on conflict, so
 * an existing saved_paragraph_index/saved_at on the same row is never
 * touched by this call (see the migration's own header comment). */
export async function recordReadingProgress(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string,
  paragraphIndex: number
): Promise<void> {
  await supabase.from('reading_places').upsert({
    user_id: userId,
    content_type: contentType,
    content_id: contentId,
    resume_paragraph_index: paragraphIndex,
    resume_updated_at: new Date().toISOString(),
  })
}

/** Deliberately saves (or moves — same call either way) the member's
 * one Saved place for this content item. Touches ONLY
 * saved_paragraph_index/saved_at — never affects the automatic-resume
 * columns on the same row. */
export async function saveReadingPlace(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string,
  paragraphIndex: number
): Promise<void> {
  await supabase.from('reading_places').upsert({
    user_id: userId,
    content_type: contentType,
    content_id: contentId,
    saved_paragraph_index: paragraphIndex,
    saved_at: new Date().toISOString(),
  })
}

/** Removes the member's Saved place for this content item, leaving any
 * automatic-resume state on the same row untouched. Does not delete the
 * row (this table has no DELETE grant to authenticated — see the
 * migration) — an empty saved-place pair is a harmless, inert row. */
export async function removeSavedReadingPlace(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string
): Promise<void> {
  await supabase
    .from('reading_places')
    .update({ saved_paragraph_index: null, saved_at: null })
    .eq('user_id', userId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
}

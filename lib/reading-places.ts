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
// no per-paragraph id infrastructure anywhere in this codebase) — PLUS
// an approximate intra-paragraph character offset (estimateCharOffset/
// estimateScrollFraction/pickCurrentParagraph below), making the anchor
// an actual exact-spot marker rather than "somewhere in this
// paragraph". See clampReadingPosition below for the recovery strategy
// when a stored paragraph index no longer fits the content's current
// paragraph count — the char offset degrades the same way, naturally,
// via its own fraction clamp.
//
// The offset is deliberately never a raw pixel/scrollTop coordinate —
// it is computed (in app/reading-position.ts, the DOM-touching half of
// this feature) from how far scrolled past a paragraph's own top the
// reading line is, as a FRACTION of that paragraph's rendered height,
// then mapped onto that paragraph's own character count. That mapping
// is an approximation (line-wrapped text doesn't fill space evenly),
// never an exact caret position, which is why it is always paired with,
// and gracefully falls back to, the paragraph-level anchor alone.

export type ContentType = 'letter' | 'dispatch'

export type ReadingPlaceState = {
  /** Automatic resume — silently tracked, never a member action. Null
   * until the member has read any of this content. */
  resumeParagraphIndex: number | null
  resumeCharOffset: number | null
  resumeUpdatedAt: string | null
  /** Deliberate Saved place — set only by an explicit "Save my place"/
   * "Move my place" action. Null until the member has saved a place in
   * this content. At most one per (member, content item) by
   * construction — saving again overwrites these same fields rather
   * than adding a row. */
  savedParagraphIndex: number | null
  savedCharOffset: number | null
  savedAt: string | null
}

const EMPTY_STATE: ReadingPlaceState = {
  resumeParagraphIndex: null,
  resumeCharOffset: null,
  resumeUpdatedAt: null,
  savedParagraphIndex: null,
  savedCharOffset: null,
  savedAt: null,
}

/** Read/write outcome for the two member-facing deliberate actions
 * (saveReadingPlace/removeSavedReadingPlace) — callers must check `ok`
 * and MUST NOT update their UI as though the place was saved/removed
 * when it is false. Automatic-progress recording (recordReadingProgress)
 * deliberately has no equivalent return value: a failed background
 * write should stay unobtrusive, never surfaced to the member, per the
 * same reasoning dispatch-reader.tsx's own silent tracking already
 * relies on — but it still logs, rather than silently discarding the
 * Supabase error the way this module previously did. */
export type PersistResult = { ok: true } | { ok: false; error: string }

/** Pure: never restores to a paragraph that no longer exists — the
 * reader always has somewhere valid to land, even if a stored position
 * from before is now out of range. A null stored index (never recorded)
 * clamps to the very start, same as an out-of-range one. */
export function clampReadingPosition(storedIndex: number | null, paragraphCount: number): number {
  if (paragraphCount <= 0 || storedIndex === null) return 0
  return Math.min(Math.max(storedIndex, 0), paragraphCount - 1)
}

/** Pure: maps how far scrolled past a paragraph's own top the reading
 * line is (as a fraction of that paragraph's own rendered height,
 * clamped to [0, 1] so an out-of-bounds fraction can never produce a
 * negative or overflowing offset) onto that paragraph's own character
 * count. An approximation, not an exact caret position — see this
 * module's own header comment. */
export function estimateCharOffset(fraction: number, paragraphLength: number): number {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  return Math.round(clamped * paragraphLength)
}

/** Pure inverse of estimateCharOffset — used on restore to turn a
 * stored offset back into a scroll fraction against the paragraph's
 * CURRENT character count. Dividing by a possibly-different current
 * length (content reflowed/changed since the offset was saved) and
 * clamping to [0, 1] is exactly the graceful degrade this feature
 * requires: a stale offset lands somewhere reasonable within the
 * paragraph rather than erroring or scrolling somewhere nonsensical. A
 * zero-length paragraph always yields 0 (no division by zero). */
export function estimateScrollFraction(charOffset: number, paragraphLength: number): number {
  if (paragraphLength <= 0) return 0
  return Math.min(Math.max(charOffset / paragraphLength, 0), 1)
}

/** One measured paragraph, in DOM-independent form — `top` is that
 * paragraph's own top edge position relative to whatever the actual
 * scroll root is (0 = flush with the scroll root's own top; negative =
 * already scrolled past it). Callers (app/reading-position.ts) compute
 * this the same way regardless of whether the scroll root is the
 * browser window (the normal Letter/Dispatch reader page) or a nested
 * overlay's own scrollable element (the reply composer's "View
 * [pseudonym]'s letter" panel) — this function itself has no idea
 * which one it was, which is exactly what makes it correct for both. */
export type MeasuredParagraph = {
  index: number
  top: number
  height: number
  textLength: number
}

/** Pure: the actual "what is the member currently reading" algorithm,
 * decoupled from the DOM so it can be tested directly (this repo's
 * Vitest environment is `node`, with no jsdom — see app/reading-
 * position.ts's own header comment on the DOM/pure split this mirrors).
 * Picks the HIGHEST-index paragraph that has scrolled fully past the
 * scroll root's own top edge (`top < 0`), re-evaluated fresh from the
 * full `paragraphs` list every call — never a ratcheting "furthest ever
 * seen" accumulator, which is exactly the bug being corrected here: the
 * previous implementation only ever moved forward, so a member who
 * scrolled back up before closing a Letter had their resume position
 * silently pinned to where they scrolled UP FROM, not down to. Returns
 * null when no paragraph has been scrolled past yet (member is still at
 * the very top) — callers treat that as "nothing to update yet", not as
 * an error. */
export function pickCurrentParagraph(paragraphs: MeasuredParagraph[]): { paragraphIndex: number; charOffset: number | null } | null {
  let current: MeasuredParagraph | null = null
  for (const paragraph of paragraphs) {
    if (paragraph.top < 0) {
      if (!current || paragraph.index > current.index) {
        current = paragraph
      }
    }
  }
  if (!current) return null

  const charOffset =
    current.textLength > 0 && current.height > 0
      ? estimateCharOffset(-current.top / current.height, current.textLength)
      : null

  return { paragraphIndex: current.index, charOffset }
}

/** The stored reading state for one (member, content item) pair, or
 * `EMPTY_STATE` shape (all nulls) if no row exists yet OR the read
 * itself failed — a read failure degrades gracefully (the reader just
 * starts from the top, same as a first-ever visit) rather than
 * throwing and breaking the page, but is still logged rather than
 * silently swallowed, unlike this module's previous implementation. */
export async function getReadingPlaceState(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string
): Promise<ReadingPlaceState> {
  const { data, error } = await supabase
    .from('reading_places')
    .select('resume_paragraph_index, resume_char_offset, resume_updated_at, saved_paragraph_index, saved_char_offset, saved_at')
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
    savedParagraphIndex: data.saved_paragraph_index as number | null,
    savedCharOffset: data.saved_char_offset as number | null,
    savedAt: data.saved_at as string | null,
  }
}

/** Silently records automatic reading progress — no Save action
 * anywhere calls this; the reader itself calls it as the member reads.
 * Touches ONLY resume_paragraph_index/resume_char_offset/
 * resume_updated_at — a plain Supabase upsert only updates the columns
 * it's given on conflict, so an existing saved_paragraph_index/
 * saved_char_offset/saved_at on the same row is never touched by this
 * call (see the migration's own header comment). A failed write here is
 * logged but never surfaced to the member — see this module's own
 * PersistResult doc comment on why automatic tracking stays unobtrusive
 * even on failure, unlike the two deliberate actions below. */
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
    console.error('[reading-places] recordReadingProgress failed (unobtrusive — automatic tracking only)', {
      message: error.message,
      contentType,
      contentId,
    })
  }
}

/** Deliberately saves (or moves — same call either way) the member's
 * one Saved place for this content item. Touches ONLY
 * saved_paragraph_index/saved_char_offset/saved_at — never affects the
 * automatic-resume columns on the same row. Returns a PersistResult the
 * caller MUST check: a failed write must never be reflected in the UI
 * as though the place were actually saved. */
export async function saveReadingPlace(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string,
  paragraphIndex: number,
  charOffset: number | null = null
): Promise<PersistResult> {
  const { error } = await supabase.from('reading_places').upsert({
    user_id: userId,
    content_type: contentType,
    content_id: contentId,
    saved_paragraph_index: paragraphIndex,
    saved_char_offset: charOffset,
    saved_at: new Date().toISOString(),
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Removes the member's Saved place for this content item, leaving any
 * automatic-resume state on the same row untouched. Does not delete the
 * row (this table has no DELETE grant to authenticated — see the
 * migration) — an empty saved-place pair is a harmless, inert row.
 * Returns a PersistResult the caller MUST check, same reasoning as
 * saveReadingPlace above. */
export async function removeSavedReadingPlace(
  supabase: SupabaseClient,
  userId: string,
  contentType: ContentType,
  contentId: string
): Promise<PersistResult> {
  const { error } = await supabase
    .from('reading_places')
    .update({ saved_paragraph_index: null, saved_char_offset: null, saved_at: null })
    .eq('user_id', userId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

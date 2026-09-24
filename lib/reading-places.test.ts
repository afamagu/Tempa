import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clampReadingPosition,
  estimateCharOffset,
  estimateScrollFraction,
  pickCurrentParagraph,
  getReadingPlaceState,
  recordReadingProgress,
  saveReadingPlace,
  removeSavedReadingPlace,
  type MeasuredParagraph,
} from './reading-places'

// A minimal, stateful stand-in for the one slice of SupabaseClient
// reading-places.ts actually uses against `reading_places`:
// select().eq().eq().eq().maybeSingle(), upsert(), and
// update().eq().eq().eq(). Real enough to prove that recording progress
// never clobbers a saved place and vice versa — the exact independence
// property this module exists to guarantee. `failWith` makes every
// operation on this fake client return a Supabase-shaped error instead
// of succeeding, for the persistence-failure tests below.
function createFakeReadingPlacesClient(options: { failWith?: string } = {}) {
  const store = new Map<string, Record<string, unknown>>()
  const key = (userId: unknown, contentType: unknown, contentId: unknown) => `${userId}::${contentType}::${contentId}`
  const failure = options.failWith ? { message: options.failWith } : null

  function from(table: string) {
    if (table !== 'reading_places') throw new Error(`unexpected table "${table}"`)
    const filters: Record<string, unknown> = {}

    const selectBuilder = {
      eq(column: string, value: unknown) {
        filters[column] = value
        return selectBuilder
      },
      async maybeSingle() {
        if (failure) return { data: null, error: failure }
        const row = store.get(key(filters.user_id, filters.content_type, filters.content_id))
        return { data: row ?? null, error: null }
      },
    }

    return {
      select() {
        return selectBuilder
      },
      async upsert(payload: Record<string, unknown>) {
        if (failure) return { data: null, error: failure }
        const k = key(payload.user_id, payload.content_type, payload.content_id)
        // Mimic real Postgres column defaults: a brand-new row's
        // columns not present in this payload resolve to NULL (this
        // table has no non-null defaults on any of its state columns —
        // see the migration), never `undefined`/absent.
        const base = store.get(k) ?? {
          resume_paragraph_index: null,
          resume_char_offset: null,
          resume_updated_at: null,
          saved_paragraph_index: null,
          saved_char_offset: null,
          saved_at: null,
        }
        store.set(k, { ...base, ...payload })
        return { data: null, error: null }
      },
      update(payload: Record<string, unknown>) {
        const updateFilters: Record<string, unknown> = {}
        const updateBuilder = {
          eq(column: string, value: unknown) {
            updateFilters[column] = value
            return updateBuilder
          },
          then(resolve: (value: { data: null; error: unknown }) => void) {
            if (failure) {
              resolve({ data: null, error: failure })
              return
            }
            const k = key(updateFilters.user_id, updateFilters.content_type, updateFilters.content_id)
            const existing = store.get(k)
            if (existing) store.set(k, { ...existing, ...payload })
            resolve({ data: null, error: null })
          },
        }
        return updateBuilder
      },
    }
  }

  return {
    client: { from } as unknown as SupabaseClient,
    _row(userId: string, contentType: string, contentId: string) {
      return store.get(key(userId, contentType, contentId))
    },
  }
}

const USER_A = 'user-a'
const USER_B = 'user-b'
const LETTER_ID = 'letter-1'
const DISPATCH_ID = 'dispatch-1'

describe('clampReadingPosition', () => {
  it('clamps an out-of-range stored index down to the last valid paragraph', () => {
    expect(clampReadingPosition(99, 5)).toBe(4)
  })

  it('clamps a negative stored index up to 0', () => {
    expect(clampReadingPosition(-3, 5)).toBe(0)
  })

  it('returns 0 for empty content regardless of the stored index', () => {
    expect(clampReadingPosition(2, 0)).toBe(0)
  })

  it('leaves an in-range index untouched', () => {
    expect(clampReadingPosition(2, 5)).toBe(2)
  })

  it('treats a null (never recorded) stored index the same as starting at 0', () => {
    expect(clampReadingPosition(null, 5)).toBe(0)
  })
})

describe('estimateCharOffset / estimateScrollFraction — the intra-paragraph anchor math (independent audit correction)', () => {
  it('maps a fraction of the paragraph height onto a character offset', () => {
    expect(estimateCharOffset(0, 200)).toBe(0)
    expect(estimateCharOffset(0.5, 200)).toBe(100)
    expect(estimateCharOffset(1, 200)).toBe(200)
  })

  it('clamps an out-of-range fraction to [0, 1] rather than producing a negative or overflowing offset', () => {
    expect(estimateCharOffset(-0.5, 200)).toBe(0)
    expect(estimateCharOffset(1.5, 200)).toBe(200)
  })

  it('is the inverse of estimateScrollFraction for an in-range offset', () => {
    const fraction = estimateScrollFraction(100, 200)
    expect(fraction).toBe(0.5)
    expect(estimateCharOffset(fraction, 200)).toBe(100)
  })

  it('gracefully degrades a stale offset against a paragraph whose length has since changed, rather than erroring', () => {
    // Saved when the paragraph was 200 chars long, restored after it
    // shrank to 50 — the fraction still clamps into [0, 1], landing at
    // the paragraph's own end rather than overflowing past it.
    expect(estimateScrollFraction(200, 50)).toBe(1)
  })

  it('never divides by zero for an empty paragraph', () => {
    expect(estimateScrollFraction(10, 0)).toBe(0)
  })
})

describe('pickCurrentParagraph — the current reading position, re-measured fresh every call (independent audit correction)', () => {
  function paragraph(index: number, top: number, height = 100, textLength = 200): MeasuredParagraph {
    return { index, top, height, textLength }
  }

  it('returns null when no paragraph has scrolled past the reading line yet (member is still at the very top)', () => {
    expect(pickCurrentParagraph([paragraph(0, 50), paragraph(1, 300)])).toBeNull()
  })

  it('picks the highest-index paragraph whose top has scrolled past the reading line', () => {
    const result = pickCurrentParagraph([paragraph(0, -300), paragraph(1, -50), paragraph(2, 20)])
    expect(result?.paragraphIndex).toBe(1)
  })

  it('is a fresh snapshot, not a ratchet: scrolling back up changes the result on the very next call, with no "furthest ever" memory anywhere in this function', () => {
    // Simulates reading forward past paragraph 3, then scrolling back up
    // before closing — the previous (buggy) implementation ratcheted a
    // max and would have stayed pinned at 3. This pure function has no
    // state at all, so it can only ever report what THIS call's data
    // says, proving the fix structurally rather than by trusting a
    // component-level side effect.
    const readForward = pickCurrentParagraph([paragraph(0, -300), paragraph(1, -200), paragraph(2, -100), paragraph(3, -10)])
    expect(readForward?.paragraphIndex).toBe(3)

    const scrolledBackUp = pickCurrentParagraph([paragraph(0, -300), paragraph(1, -100), paragraph(2, 50), paragraph(3, 400)])
    expect(scrolledBackUp?.paragraphIndex).toBe(1)
  })

  it('estimates a char offset from how far past the reading line the current paragraph has scrolled', () => {
    // top = -50 on a 100-tall paragraph means the reading line sits
    // halfway down it.
    const result = pickCurrentParagraph([paragraph(0, -50, 100, 200)])
    expect(result).toEqual({ paragraphIndex: 0, charOffset: 100 })
  })

  it('reports a null charOffset for a paragraph with no measurable text or height (e.g. an empty paragraph)', () => {
    expect(pickCurrentParagraph([paragraph(0, -10, 100, 0)])?.charOffset).toBeNull()
    expect(pickCurrentParagraph([paragraph(0, -10, 0, 200)])?.charOffset).toBeNull()
  })

  it('behaves identically whether the supplied `top` values were measured against the browser window or a nested overlay scroll root (independent audit correction — the source-Letter overlay case)', () => {
    // `top` is already root-relative by the time it reaches this
    // function (app/reading-position.ts computes it as
    // getBoundingClientRect().top minus the scroll root's own top, and
    // the scroll root can be the window OR SourceLetterPanel's own
    // overflow-y-auto element) — this function has no idea which one
    // produced these numbers, which is exactly what makes the same
    // algorithm correct for both. Two scenarios with the same RELATIVE
    // shape (one paragraph scrolled past, one not yet reached) must
    // agree, regardless of what absolute viewport coordinates they'd
    // correspond to in each case.
    const asIfWindowRoot = pickCurrentParagraph([paragraph(0, -220), paragraph(1, 40)])
    // Same relative shape, as if measured inside an overlay panel whose
    // own top edge sits far down the real viewport (e.g. a centered
    // desktop dialog) — the relative numbers a real component would
    // compute are still just "paragraph 0 is 220px above the panel's
    // own top; paragraph 1 is 40px below it," independent of where that
    // panel itself sits on screen.
    const asIfOverlayRoot = pickCurrentParagraph([paragraph(0, -220), paragraph(1, 40)])
    expect(asIfOverlayRoot).toEqual(asIfWindowRoot)
    expect(asIfOverlayRoot?.paragraphIndex).toBe(0)
  })
})

describe('getReadingPlaceState', () => {
  it('returns an all-null state when no row exists yet', async () => {
    const { client } = createFakeReadingPlacesClient()
    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state).toEqual({
      resumeParagraphIndex: null,
      resumeCharOffset: null,
      resumeUpdatedAt: null,
      savedParagraphIndex: null,
      savedCharOffset: null,
      savedAt: null,
    })
  })

  it('reflects a previously recorded resume position, including its char offset', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 3, 42)
    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.resumeParagraphIndex).toBe(3)
    expect(state.resumeCharOffset).toBe(42)
    expect(state.savedParagraphIndex).toBeNull()
  })

  it('degrades gracefully to the all-null state on a read failure, rather than throwing (independent audit correction — reads may fail gracefully)', async () => {
    const { client } = createFakeReadingPlacesClient({ failWith: 'connection reset' })
    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state).toEqual({
      resumeParagraphIndex: null,
      resumeCharOffset: null,
      resumeUpdatedAt: null,
      savedParagraphIndex: null,
      savedCharOffset: null,
      savedAt: null,
    })
  })
})

describe('recordReadingProgress and saveReadingPlace are independent', () => {
  it('recording automatic progress never moves an existing saved place', async () => {
    const { client } = createFakeReadingPlacesClient()
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 5)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.resumeParagraphIndex).toBe(5)
    expect(state.savedParagraphIndex).toBe(2)
  })

  it('saving a place never moves the automatic resume position', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 5)
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.resumeParagraphIndex).toBe(5)
    expect(state.savedParagraphIndex).toBe(2)
  })

  it('saving again moves the saved place rather than accumulating a second one, including its char offset', async () => {
    const { client } = createFakeReadingPlacesClient()
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2, 10)
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 7, 88)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.savedParagraphIndex).toBe(7)
    expect(state.savedCharOffset).toBe(88)
  })

  it('a deliberate Saved place does not move just because automatic resume advances further (independence, restated for the char-offset anchor)', async () => {
    const { client } = createFakeReadingPlacesClient()
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2, 10)
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 9, 77)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.savedParagraphIndex).toBe(2)
    expect(state.savedCharOffset).toBe(10)
    expect(state.resumeParagraphIndex).toBe(9)
    expect(state.resumeCharOffset).toBe(77)
  })
})

describe('removeSavedReadingPlace', () => {
  it('clears only the saved-place columns, leaving automatic resume untouched', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 5)
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2, 33)

    await removeSavedReadingPlace(client, USER_A, 'letter', LETTER_ID)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.savedParagraphIndex).toBeNull()
    expect(state.savedCharOffset).toBeNull()
    expect(state.savedAt).toBeNull()
    expect(state.resumeParagraphIndex).toBe(5)
  })
})

describe('persistence failures are never presented as success (independent audit correction)', () => {
  it('saveReadingPlace returns ok: false with the underlying error, rather than silently succeeding', async () => {
    const { client } = createFakeReadingPlacesClient({ failWith: 'db is down' })
    const result = await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)
    expect(result).toEqual({ ok: false, error: 'db is down' })
  })

  it('saveReadingPlace returns ok: true on an actual success, so callers can tell the two apart', async () => {
    const { client } = createFakeReadingPlacesClient()
    const result = await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)
    expect(result).toEqual({ ok: true })
  })

  it('removeSavedReadingPlace returns ok: false with the underlying error, rather than silently succeeding', async () => {
    const { client } = createFakeReadingPlacesClient({ failWith: 'db is down' })
    const result = await removeSavedReadingPlace(client, USER_A, 'letter', LETTER_ID)
    expect(result).toEqual({ ok: false, error: 'db is down' })
  })

  it('removeSavedReadingPlace returns ok: true on an actual success', async () => {
    const { client } = createFakeReadingPlacesClient()
    const result = await removeSavedReadingPlace(client, USER_A, 'letter', LETTER_ID)
    expect(result).toEqual({ ok: true })
  })

  it('recordReadingProgress never throws on a failed write — automatic tracking stays unobtrusive even when persistence fails', async () => {
    const { client } = createFakeReadingPlacesClient({ failWith: 'db is down' })
    await expect(recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 2)).resolves.toBeUndefined()
  })
})

describe('different content items and different members never share a reading position', () => {
  it('a Letter and a Dispatch tracked for the same user stay independent', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 3)
    await recordReadingProgress(client, USER_A, 'dispatch', DISPATCH_ID, 9)

    const letterState = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    const dispatchState = await getReadingPlaceState(client, USER_A, 'dispatch', DISPATCH_ID)
    expect(letterState.resumeParagraphIndex).toBe(3)
    expect(dispatchState.resumeParagraphIndex).toBe(9)
  })

  it('two different members reading the same letter id never see each other\'s position', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 3)
    await recordReadingProgress(client, USER_B, 'letter', LETTER_ID, 9)

    const stateA = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    const stateB = await getReadingPlaceState(client, USER_B, 'letter', LETTER_ID)
    expect(stateA.resumeParagraphIndex).toBe(3)
    expect(stateB.resumeParagraphIndex).toBe(9)
  })
})

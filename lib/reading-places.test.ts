import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clampReadingPosition,
  getReadingPlaceState,
  recordReadingProgress,
  saveReadingPlace,
  removeSavedReadingPlace,
} from './reading-places'

// A minimal, stateful stand-in for the one slice of SupabaseClient
// reading-places.ts actually uses against `reading_places`:
// select().eq().eq().eq().maybeSingle(), upsert(), and
// update().eq().eq().eq(). Real enough to prove that recording progress
// never clobbers a saved place and vice versa — the exact independence
// property this module exists to guarantee.
function createFakeReadingPlacesClient() {
  const store = new Map<string, Record<string, unknown>>()
  const key = (userId: unknown, contentType: unknown, contentId: unknown) => `${userId}::${contentType}::${contentId}`

  function from(table: string) {
    if (table !== 'reading_places') throw new Error(`unexpected table "${table}"`)
    const filters: Record<string, unknown> = {}

    const selectBuilder = {
      eq(column: string, value: unknown) {
        filters[column] = value
        return selectBuilder
      },
      async maybeSingle() {
        const row = store.get(key(filters.user_id, filters.content_type, filters.content_id))
        return { data: row ?? null, error: null }
      },
    }

    return {
      select() {
        return selectBuilder
      },
      async upsert(payload: Record<string, unknown>) {
        const k = key(payload.user_id, payload.content_type, payload.content_id)
        // Mimic real Postgres column defaults: a brand-new row's
        // columns not present in this payload resolve to NULL (this
        // table has no non-null defaults on any of its state columns —
        // see the migration), never `undefined`/absent.
        const base = store.get(k) ?? {
          resume_paragraph_index: null,
          resume_updated_at: null,
          saved_paragraph_index: null,
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
          then(resolve: (value: { data: null; error: null }) => void) {
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

describe('getReadingPlaceState', () => {
  it('returns an all-null state when no row exists yet', async () => {
    const { client } = createFakeReadingPlacesClient()
    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state).toEqual({
      resumeParagraphIndex: null,
      resumeUpdatedAt: null,
      savedParagraphIndex: null,
      savedAt: null,
    })
  })

  it('reflects a previously recorded resume position', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 3)
    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.resumeParagraphIndex).toBe(3)
    expect(state.savedParagraphIndex).toBeNull()
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

  it('saving again moves the saved place rather than accumulating a second one', async () => {
    const { client } = createFakeReadingPlacesClient()
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 7)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.savedParagraphIndex).toBe(7)
  })
})

describe('removeSavedReadingPlace', () => {
  it('clears only the saved-place columns, leaving automatic resume untouched', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, USER_A, 'letter', LETTER_ID, 5)
    await saveReadingPlace(client, USER_A, 'letter', LETTER_ID, 2)

    await removeSavedReadingPlace(client, USER_A, 'letter', LETTER_ID)

    const state = await getReadingPlaceState(client, USER_A, 'letter', LETTER_ID)
    expect(state.savedParagraphIndex).toBeNull()
    expect(state.savedAt).toBeNull()
    expect(state.resumeParagraphIndex).toBe(5)
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

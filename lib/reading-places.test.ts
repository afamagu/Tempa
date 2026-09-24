import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clampReadingPosition,
  estimateCharOffset,
  estimateScrollFraction,
  pickCurrentParagraph,
  getReadingPlaceState,
  recordReadingProgress,
  type MeasuredParagraph,
} from './reading-places'

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
        return { data: store.get(key(filters.user_id, filters.content_type, filters.content_id)) ?? null, error: null }
      },
    }

    return {
      select() {
        return selectBuilder
      },
      async upsert(payload: Record<string, unknown>) {
        if (failure) return { data: null, error: failure }
        const k = key(payload.user_id, payload.content_type, payload.content_id)
        const base = store.get(k) ?? {
          resume_paragraph_index: null,
          resume_char_offset: null,
          resume_updated_at: null,
        }
        store.set(k, { ...base, ...payload })
        return { data: null, error: null }
      },
    }
  }

  return { client: { from } as unknown as SupabaseClient }
}

describe('automatic reading-position math', () => {
  it('clamps stale paragraph positions safely', () => {
    expect(clampReadingPosition(99, 5)).toBe(4)
    expect(clampReadingPosition(-3, 5)).toBe(0)
    expect(clampReadingPosition(null, 5)).toBe(0)
  })

  it('maps an intra-paragraph fraction to a stable approximate character offset and back', () => {
    expect(estimateCharOffset(0.5, 200)).toBe(100)
    expect(estimateScrollFraction(100, 200)).toBe(0.5)
    expect(estimateScrollFraction(10, 0)).toBe(0)
  })

  it('re-measures current position rather than remembering the furthest point ever reached', () => {
    const p = (index: number, top: number): MeasuredParagraph => ({ index, top, height: 100, textLength: 200 })
    expect(pickCurrentParagraph([p(0, -300), p(1, -50), p(2, 30)])?.paragraphIndex).toBe(1)
    expect(pickCurrentParagraph([p(0, -100), p(1, 50), p(2, 400)])?.paragraphIndex).toBe(0)
  })
})

describe('automatic Reading Places persistence', () => {
  it('returns empty resume state when no row exists', async () => {
    const { client } = createFakeReadingPlacesClient()
    expect(await getReadingPlaceState(client, 'user-a', 'letter', 'letter-1')).toEqual({
      resumeParagraphIndex: null,
      resumeCharOffset: null,
      resumeUpdatedAt: null,
    })
  })

  it('round-trips a resume position', async () => {
    const { client } = createFakeReadingPlacesClient()
    await recordReadingProgress(client, 'user-a', 'letter', 'letter-1', 3, 42)
    const state = await getReadingPlaceState(client, 'user-a', 'letter', 'letter-1')
    expect(state.resumeParagraphIndex).toBe(3)
    expect(state.resumeCharOffset).toBe(42)
    expect(state.resumeUpdatedAt).not.toBeNull()
  })

  it('degrades to empty state when a read fails', async () => {
    const { client } = createFakeReadingPlacesClient({ failWith: 'db is down' })
    expect(await getReadingPlaceState(client, 'user-a', 'letter', 'letter-1')).toEqual({
      resumeParagraphIndex: null,
      resumeCharOffset: null,
      resumeUpdatedAt: null,
    })
  })
})

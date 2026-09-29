import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWritingSample, plainWords } from './writing-style-sample'
import { RICH_BODY_MARKER } from './letter-editor-doc'
import { WRITING_STYLE_FALLBACK_SAMPLE } from './writing-style'

type Rows = Record<string, unknown[]>

// Minimal query-builder fake: every chain resolves to the rows for its table.
function fakeSupabase(rows: Rows): SupabaseClient {
  const builder = (table: string) => {
    const result = { data: rows[table] ?? [], error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'is', 'neq', 'maybeSingle']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return chain
  }
  return { from: builder, rpc: async () => ({ data: [], error: null }), storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } } as unknown as SupabaseClient
}

describe('the preview uses the member’s own words', () => {
  it('prefers the Flagship response they have just written', async () => {
    const supabase = fakeSupabase({
      question_answers: [
        { id: 'a1', question_id: 'q1', body: 'An older, other answer.', updated_at: '2026-01-02', is_current: false, moderation_status: 'visible' },
        { id: 'a2', question_id: 'q2', body: 'My flagship answer, in my words.', updated_at: '2026-01-01', is_current: true, moderation_status: 'visible' },
      ],
      questions: [
        { id: 'q1', prompt: 'Other?', is_flagship: false, is_active: true },
        { id: 'q2', prompt: 'Flagship?', is_flagship: true, is_active: true },
      ],
    })
    expect(await getWritingSample(supabase, 'u1')).toEqual({ text: 'My flagship answer, in my words.', source: 'flagship' })
  })

  it('falls back to the restrained Tempa sample only when nothing is written', async () => {
    const sample = await getWritingSample(fakeSupabase({}), 'u1')
    expect(sample).toEqual({ text: WRITING_STYLE_FALLBACK_SAMPLE, source: 'fallback' })
  })

  it('never shows markup delimiters as literal characters', () => {
    expect(plainWords(`${RICH_BODY_MARKER}A **bold** and _quiet_ line.`)).toBe('A bold and quiet line.')
    expect(plainWords('Plain **stays** literal.')).toBe('Plain **stays** literal.')
  })
})

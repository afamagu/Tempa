import { describe, it, expect, vi } from 'vitest'
import {
  canonicalizePseudonym,
  editorialAuthorName,
  editorialTitleFor,
  getEditorialBylines,
  toEditorialBylines,
} from './editorial-byline'

const client = (rpc: (...args: unknown[]) => unknown) => ({ rpc: vi.fn(rpc) }) as never

describe('canonicalizePseudonym', () => {
  it('matches public.canonicalize_pseudonym: trim, lowercase, strip spaces and hyphens', () => {
    for (const v of ['Lady Larkspur', '  lady larkspur ', 'Lady-Larkspur', 'LADY - LARKSPUR', 'LadyLarkspur']) {
      expect(canonicalizePseudonym(v)).toBe('ladylarkspur')
    }
  })
})

describe('toEditorialBylines', () => {
  it('keeps only well-formed rows', () => {
    const map = toEditorialBylines([
      { pseudonym_key: 'ladylarkspur', editorial_title: ' Tempa House Columnist ' },
      { pseudonym_key: '', editorial_title: 'x' },
      { pseudonym_key: 'blank', editorial_title: '  ' },
      { pseudonym_key: 'long', editorial_title: 'x'.repeat(61) },
      { web_slug: 'not-a-byline-row' },
      null,
    ])
    expect([...map]).toEqual([['ladylarkspur', 'Tempa House Columnist']])
    expect(toEditorialBylines(null).size).toBe(0)
  })
})

describe('getEditorialBylines', () => {
  it('reads the one RPC', async () => {
    const supabase = client(async () => ({ data: [{ pseudonym_key: 'ladylarkspur', editorial_title: 'Tempa House Columnist' }], error: null }))
    const map = await getEditorialBylines(supabase)
    expect(editorialTitleFor(map, 'Lady Larkspur')).toBe('Tempa House Columnist')
    expect(editorialTitleFor(map, 'Evening Quill')).toBeNull()
    expect(editorialTitleFor(map, null)).toBeNull()
    expect((supabase as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('editorial_bylines')
  })

  it('asks once per client (one request renders several surfaces)', async () => {
    const supabase = client(async () => ({ data: [], error: null }))
    await Promise.all([getEditorialBylines(supabase), getEditorialBylines(supabase), getEditorialBylines(supabase)])
    expect((supabase as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledTimes(1)
  })

  it('fails soft — migration not live, RPC error, or a throwing client all mean "no bylines"', async () => {
    expect((await getEditorialBylines(client(async () => ({ data: null, error: { code: 'PGRST202' } })))).size).toBe(0)
    expect((await getEditorialBylines(client(async () => { throw new Error('network') }))).size).toBe(0)
    expect((await getEditorialBylines(client(() => { throw new Error('sync') }))).size).toBe(0)
  })
})

describe('editorialAuthorName', () => {
  it('is the search-engine author string for a house account, the plain name otherwise', () => {
    expect(editorialAuthorName('Lady Larkspur', 'Tempa House Columnist')).toBe('Lady Larkspur, Tempa House Columnist')
    expect(editorialAuthorName('Evening Quill', null)).toBe('Evening Quill')
  })
})

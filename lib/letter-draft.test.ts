import { afterEach, describe, expect, it } from 'vitest'
import { readLetterDraft, writeLetterDraft } from './letter-draft'

function uninstallWindow() {
  delete (globalThis as { window?: unknown }).window
}

describe('letter-draft persistence result', () => {
  afterEach(uninstallWindow)

  it('returns true when the draft is persisted normally', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
    ;(globalThis as unknown as { window: { localStorage: typeof storage } }).window = { localStorage: storage }

    expect(writeLetterDraft('corr-1', 'A careful reply')).toBe(true)
    expect(readLetterDraft('corr-1')).toBe('A careful reply')
  })

  it('returns false instead of pretending autosave worked when storage rejects the write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    }
    ;(globalThis as unknown as { window: { localStorage: typeof storage } }).window = { localStorage: storage }

    expect(writeLetterDraft('corr-1', 'A careful reply')).toBe(false)
  })

  it('returns false without throwing when no browser storage exists', () => {
    expect(() => writeLetterDraft('corr-1', 'A careful reply')).not.toThrow()
    expect(writeLetterDraft('corr-1', 'A careful reply')).toBe(false)
  })
})

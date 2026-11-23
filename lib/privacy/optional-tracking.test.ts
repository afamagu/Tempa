import { describe, expect, it, vi } from 'vitest'
import { mayStartOptionalTracking, runOptionalTracking } from './optional-tracking'

describe('privacy-by-default optional tracking gate', () => {
  it.each(['unknown', 'denied'] as const)('blocks optional tracking when %s', (consent) => {
    const start = vi.fn()
    expect(mayStartOptionalTracking(consent)).toBe(false)
    expect(runOptionalTracking(consent, start)).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })

  it('permits an explicitly granted optional integration', () => {
    const start = vi.fn()
    expect(runOptionalTracking('granted', start)).toBe(true)
    expect(start).toHaveBeenCalledOnce()
  })

  it('blocks further calls after consent withdrawal', () => {
    const start = vi.fn()
    runOptionalTracking('granted', start)
    runOptionalTracking('denied', start)
    expect(start).toHaveBeenCalledOnce()
  })
})

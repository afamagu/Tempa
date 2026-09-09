import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce behavior: multiple calls within the delay window only fire once, with the latest args', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d.call('w')
    vi.advanceTimersByTime(100)
    d.call('wa')
    vi.advanceTimersByTime(100)
    d.call('walk')

    expect(fn).not.toHaveBeenCalled() // still within the window each time

    vi.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('walk')
  })

  it('a call that completes its full delay fires exactly once', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d.call('walked')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('walked')
  })

  it('Enter (flush) fires immediately, without waiting for the delay', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d.call('typing')
    vi.advanceTimersByTime(50) // well within the debounce window
    d.flush('typing')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('typing')
  })

  it('flush cancels the pending debounced call so it never fires a second time afterward', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d.call('typing')
    d.flush('typing')
    vi.advanceTimersByTime(1000) // well past the original delay

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel discards a pending call without ever running it', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d.call('typing')
    d.cancel()
    vi.advanceTimersByTime(1000)

    expect(fn).not.toHaveBeenCalled()
  })
})

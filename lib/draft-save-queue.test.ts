import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraftSaveQueue } from './draft-save-queue'

afterEach(() => vi.useRealTimers())
describe('draft save queue', () => {
  it('coalesces a burst and reads the latest document only at save time', () => {
    vi.useFakeTimers()
    let text = ''
    const saved: string[] = []
    const queue = createDraftSaveQueue(() => { saved.push(text); return true }, vi.fn())
    for (const word of ['H', 'He', 'Hello']) { text = word; queue.schedule(); vi.advanceTimersByTime(100) }
    expect(saved).toEqual([])
    vi.advanceTimersByTime(200)
    expect(saved).toEqual(['Hello'])
  })
  it('saves during continuous typing within the maximum wait', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => true)
    const queue = createDraftSaveQueue(save, vi.fn())
    for (let i = 0; i < 12; i++) { queue.schedule(); vi.advanceTimersByTime(100) }
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('flushes before navigation and cannot resurrect a sent draft after cancellation', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => true)
    const queue = createDraftSaveQueue(save, vi.fn())
    queue.schedule(); queue.flush()
    expect(save).toHaveBeenCalledTimes(1)
    queue.schedule(); queue.cancel(); vi.runAllTimers()
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('reports both refused and thrown storage writes', () => {
    const failure = vi.fn()
    const queue = createDraftSaveQueue(() => false, failure)
    queue.schedule(); expect(queue.flush()).toBe(false)
    const throwing = createDraftSaveQueue(() => { throw Error('QuotaExceeded') }, failure)
    throwing.schedule(); expect(throwing.flush()).toBe(false)
    expect(failure).toHaveBeenCalledTimes(2)
  })
})

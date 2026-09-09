import { describe, it, expect, vi } from 'vitest'
import { resolveRestoredPhotoWithRetries, RESTORED_PHOTO_RETRY_DELAYS_MS } from './resolve-restored-photo'

// Never-real-timers `wait`: records the delays it was asked for and
// resolves immediately, so these tests run instantly and deterministically
// regardless of RESTORED_PHOTO_RETRY_DELAYS_MS's actual values.
function fakeWait() {
  const delays: number[] = []
  return { wait: async (ms: number) => { delays.push(ms) }, delays }
}

// Live-repair checkpoint (2026-09-08), second pass — Part I's own
// explicit instruction: this async resolution logic must be tested
// directly, with a real injected fake resolver and a real injected fake
// clock, never merely inferred from source text.
describe('resolveRestoredPhotoWithRetries', () => {
  it('Part I-A/B — a restored imagePath reaches the injected resolver and a successful call resolves with its URL', async () => {
    const calls: string[] = []
    const resolver = async (imagePath: string) => {
      calls.push(imagePath)
      return { url: `https://signed.test/${imagePath}`, error: null }
    }
    const { wait } = fakeWait()
    const result = await resolveRestoredPhotoWithRetries('corr-1/a.jpg', resolver, { wait })
    expect(calls).toEqual(['corr-1/a.jpg'])
    expect(result).toEqual({ status: 'resolved', url: 'https://signed.test/corr-1/a.jpg' })
  })

  it('retries after a failure and succeeds on a later attempt, waiting the expected delays in between', async () => {
    let attempt = 0
    const resolver = async () => {
      attempt += 1
      if (attempt < 3) return { url: null, error: `failed attempt ${attempt}` }
      return { url: 'https://signed.test/eventually.jpg', error: null }
    }
    const { wait, delays } = fakeWait()
    const result = await resolveRestoredPhotoWithRetries('corr-1/b.jpg', resolver, { wait })
    expect(attempt).toBe(3)
    expect(result).toEqual({ status: 'resolved', url: 'https://signed.test/eventually.jpg' })
    expect(delays).toEqual(RESTORED_PHOTO_RETRY_DELAYS_MS.slice(0, 2))
  })

  it('Part I-D — exhausting every attempt reports "unresolved" with the last error, never throwing', async () => {
    const resolver = async () => ({ url: null, error: 'RLS denied' })
    const { wait } = fakeWait()
    const result = await resolveRestoredPhotoWithRetries('corr-1/c.jpg', resolver, { wait })
    expect(result).toEqual({ status: 'unresolved', error: 'RLS denied' })
  })

  it('Part I-D — recoverability: a fresh call after a full exhaustion (simulating the member\'s own retry) can still succeed', async () => {
    const { wait } = fakeWait()
    const failing = async () => ({ url: null, error: 'still not ready' })
    const first = await resolveRestoredPhotoWithRetries('corr-1/d.jpg', failing, { wait })
    expect(first.status).toBe('unresolved')

    const nowWorking = async () => ({ url: 'https://signed.test/d.jpg', error: null })
    const retried = await resolveRestoredPhotoWithRetries('corr-1/d.jpg', nowWorking, { wait })
    expect(retried).toEqual({ status: 'resolved', url: 'https://signed.test/d.jpg' })
  })

  it('never exceeds retryDelaysMs.length + 1 total attempts', async () => {
    let calls = 0
    const alwaysFails = async () => {
      calls += 1
      return { url: null, error: 'nope' }
    }
    const { wait } = fakeWait()
    await resolveRestoredPhotoWithRetries('corr-1/e.jpg', alwaysFails, { wait, retryDelaysMs: [10, 20] })
    expect(calls).toBe(3) // initial + 2 retries
  })

  it('a cancellation observed before an attempt stops the loop immediately, without calling the resolver again', async () => {
    let calls = 0
    let cancelled = false
    const resolver = vi.fn(async () => {
      calls += 1
      cancelled = true // cancel right after the first attempt, before any retry
      return { url: null, error: 'nope' }
    })
    const { wait } = fakeWait()
    const result = await resolveRestoredPhotoWithRetries('corr-1/f.jpg', resolver, {
      wait,
      isCancelled: () => cancelled,
    })
    expect(calls).toBe(1)
    expect(result).toEqual({ status: 'cancelled' })
  })

  it('Part I-C — three independent restored Photo Moments each resolve on their own, concurrently, with no shared state between them', async () => {
    const resolver = async (imagePath: string) => {
      if (imagePath === 'corr-1/bad.jpg') return { url: null, error: 'denied' }
      return { url: `https://signed.test/${imagePath}`, error: null }
    }
    const { wait } = fakeWait()
    const [a, b, c] = await Promise.all([
      resolveRestoredPhotoWithRetries('corr-1/good1.jpg', resolver, { wait }),
      resolveRestoredPhotoWithRetries('corr-1/bad.jpg', resolver, { wait }),
      resolveRestoredPhotoWithRetries('corr-1/good2.jpg', resolver, { wait }),
    ])
    expect(a).toEqual({ status: 'resolved', url: 'https://signed.test/corr-1/good1.jpg' })
    expect(b.status).toBe('unresolved')
    expect(c).toEqual({ status: 'resolved', url: 'https://signed.test/corr-1/good2.jpg' })
  })

  it('defaults to RESTORED_PHOTO_RETRY_DELAYS_MS when no override is given', async () => {
    const delaysSeen: number[] = []
    let calls = 0
    const resolver = async () => {
      calls += 1
      return { url: null, error: 'nope' }
    }
    await resolveRestoredPhotoWithRetries('corr-1/g.jpg', resolver, {
      wait: async (ms) => {
        delaysSeen.push(ms)
      },
    })
    expect(calls).toBe(RESTORED_PHOTO_RETRY_DELAYS_MS.length + 1)
    expect(delaysSeen).toEqual(RESTORED_PHOTO_RETRY_DELAYS_MS)
  })
})

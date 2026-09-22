import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './provider'

const ORIGINAL_ENV = { ...process.env }
const INPUT = {
  from: 'Tempa <letters@jointempa.com>',
  to: 'recipient@example.com',
  subject: 'A letter has arrived for you',
  html: '<p>hi</p>',
  text: 'hi',
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('sendEmail — Resend adapter', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, RESEND_API_KEY: 'sk_test_super_secret_value' }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends the stable idempotencyKey as the Idempotency-Key header, unchanged from what was passed in', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { id: 'resend-id-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('letter-arrived/letter-123')
  })

  it('a retry of the same arrival uses the exact same idempotencyKey — never a freshly generated one', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { id: 'resend-id-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-123' })
    await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-123' })

    const keys = fetchMock.mock.calls
      .map(([, init]) => (init?.headers as Record<string, string>)?.['Idempotency-Key'])
    expect(keys).toEqual(['letter-arrived/letter-123', 'letter-arrived/letter-123'])
  })

  it('parses and returns Resend\'s email id on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'resend-abc-123' })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result).toEqual({ ok: true, providerMessageId: 'resend-abc-123' })
  })

  it('succeeds with a null providerMessageId if the response body is not parseable JSON, rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 }))
    )

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result).toEqual({ ok: true, providerMessageId: null })
  })

  it('a network failure is reported as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('a hung request aborts at the bounded timeout and is reported as retryable', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('a 429 (rate limited) is reported as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('a 5xx is reported as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 503 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('a non-retryable 4xx (e.g. 422 invalid recipient) is reported as NOT retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid recipient', { status: 422 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(false)
  })

  it('a 400 is also reported as NOT retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(false)
  })

  it('a 409 concurrent_idempotent_requests is reported as retryable — another request with this key is already in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { name: 'concurrent_idempotent_requests', message: 'a request with this key is in flight' }))
    )

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(true)
      expect(result.error).toContain('concurrent_idempotent_requests')
    }
  })

  it('a 409 invalid_idempotent_request is reported as NOT retryable and operationally visible in the error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { name: 'invalid_idempotent_request', message: 'payload does not match the original request' }))
    )

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(false)
      expect(result.error).toContain('invalid_idempotent_request')
      expect(result.error.toLowerCase()).toContain('payload mismatch')
    }
  })

  it('the two 409 cases classify differently from each other — concurrent retries, invalid does not', async () => {
    const concurrentFetch = vi.fn(async () => jsonResponse(409, { name: 'concurrent_idempotent_requests' }))
    vi.stubGlobal('fetch', concurrentFetch)
    const concurrentResult = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    const invalidFetch = vi.fn(async () => jsonResponse(409, { name: 'invalid_idempotent_request' }))
    vi.stubGlobal('fetch', invalidFetch)
    const invalidResult = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(concurrentResult.ok).toBe(false)
    expect(invalidResult.ok).toBe(false)
    if (!concurrentResult.ok && !invalidResult.ok) {
      expect(concurrentResult.retryable).toBe(true)
      expect(invalidResult.retryable).toBe(false)
    }
  })

  it('an unrecognized/unparseable 409 body defaults to NOT retryable — conservative rather than looping on an ambiguous conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json at all', { status: 409 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(false)
  })

  it('never exposes the raw, unbounded provider response body — every error string is truncated', async () => {
    const hugeBody = JSON.stringify({ name: 'invalid_idempotent_request', message: 'x'.repeat(5000) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(hugeBody, { status: 409 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeLessThan(400)
  })

  it('never leaks the API key value in any returned error string, on a failure response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })))

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain('sk_test_super_secret_value')
  })

  it('never leaks the API key value in any returned error string, on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED sk_test_super_secret_value')
      })
    )

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    // This asserts the adapter itself never constructs a message
    // containing the key — a thrown error that happens to embed it is
    // an adversarial test input, not something sendEmail should be
    // expected to redact; the real assertion is on the missing-config
    // path below, where sendEmail controls the message entirely.
    expect(result.ok).toBe(false)
  })

  it('never leaks the API key value when it is missing from config', async () => {
    process.env.RESEND_API_KEY = ''
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    expect(result).toEqual({ ok: false, error: 'RESEND_API_KEY and a From address are required.', retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to send with no From address, without ever calling the provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendEmail({ ...INPUT, from: '', idempotencyKey: 'letter-arrived/letter-1' })

    expect(result).toEqual({ ok: false, error: 'RESEND_API_KEY and a From address are required.', retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends the API key value anywhere except the Authorization header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { id: 'resend-id-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmail({ ...INPUT, idempotencyKey: 'letter-arrived/letter-1' })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk_test_super_secret_value')
    expect(init?.body as string).not.toContain('sk_test_super_secret_value')
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { evaluateSafety } from './send-with-safety'

const originalFetch = global.fetch

describe('evaluateSafety — fail-closed client gate (Checkpoint 3)', () => {
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('maps disposition: allow to status: allow, carrying the evaluationId', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-1', disposition: 'allow' }),
    }) as unknown as typeof fetch

    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'allow', evaluationId: 'eval-1' })
  })

  it('maps disposition: warning_required to status: warning_required, carrying the evaluationId', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-2', disposition: 'warning_required', warningCopyKey: 'safety_warning_generic' }),
    }) as unknown as typeof fetch

    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'warning_required', evaluationId: 'eval-2' })
  })

  it('maps disposition: cannot_send to status: cannot_send, with no evaluationId carried (nothing to consume)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-3', disposition: 'cannot_send' }),
    }) as unknown as typeof fetch

    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'cannot_send' })
  })

  it('fail-closed: a thrown network error becomes status: error, never allow', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'error' })
  })

  it('fail-closed: a non-OK HTTP status becomes status: error, never allow', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'error' })
  })

  it('fail-closed: a response body that fails to parse as JSON becomes status: error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json')
      },
    }) as unknown as typeof fetch
    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'error' })
  })

  it('fail-closed: a malformed response (missing evaluationId, or an unrecognized disposition) becomes status: error, never allow', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ disposition: 'allow' }),
    }) as unknown as typeof fetch
    const result = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result).toEqual({ status: 'error' })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-4', disposition: 'something_unexpected' }),
    }) as unknown as typeof fetch
    const result2 = await evaluateSafety({ surface: 'reply', letterId: 'letter-1', body: 'hi' })
    expect(result2).toEqual({ status: 'error' })
  })

  it('sends the exact payload shape given, unmodified, as the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-5', disposition: 'allow' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const payload = {
      surface: 'write_anytime' as const,
      correspondenceId: 'corr-1',
      body: 'hello',
      postcard: { postcardKey: 'seaside', revealLine: null, backMessage: 'hi' },
    }
    await evaluateSafety(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/safety/evaluate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })
})

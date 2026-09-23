import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const rpcSingle = vi.fn()
const rpc = vi.fn<(name: string, params: Record<string, unknown>) => { single: typeof rpcSingle }>(() => ({
  single: rpcSingle,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc }),
}))

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111'

function request(body: unknown, init: { asString?: string } = {}) {
  return new NextRequest('https://jointempa.com/api/safety/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: init.asString ?? JSON.stringify(body),
  })
}

describe('POST /api/safety/evaluate', () => {
  beforeEach(() => {
    getUser.mockReset()
    rpc.mockClear()
    rpcSingle.mockReset()
  })

  it('rejects an unauthenticated request without ever calling the classifier or the recording RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    const { POST } = await import('./route')
    const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Hi there.' }))
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('derives the user id from the authenticated session, never from the request body', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'session-user-id' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-1', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    await POST(
      request({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        body: 'Hi there.',
        userId: 'attacker-supplied-id',
      })
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    const [, params] = rpc.mock.calls[0]
    expect(params).toMatchObject({ p_user_id: 'session-user-id' })
  })

  it('rejects invalid JSON with 400', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request(undefined, { asString: '{not json' }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an unknown surface with 400', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request({ surface: 'admin_panel', body: 'hi' }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('classifies a benign body and returns allow with no warning key', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-1', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Food is expensive here.' }))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({ evaluationId: 'eval-1', disposition: 'allow' })
  })

  it('classifies a clear violation and returns cannot_send with a warning key, never a risk band or reason codes', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-2', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    const response = await POST(
      request({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Buy a Steam gift card and send me the code.' })
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.evaluationId).toBe('eval-2')
    expect(json.disposition).toBe('cannot_send')
    expect(json).toHaveProperty('warningCopyKey')
    expect(json).not.toHaveProperty('riskBand')
    expect(json).not.toHaveProperty('reasonCodes')
    expect(json).not.toHaveProperty('indicators')
  })

  it('passes the exact classified fields through to record_safety_evaluation', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-3', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    await POST(request({ surface: 'reply', letterId: RECIPIENT_ID, body: 'Can you send me $300?' }))

    expect(rpc).toHaveBeenCalledWith(
      'record_safety_evaluation',
      expect.objectContaining({
        p_user_id: 'u1',
        p_surface: 'reply',
        p_context_id: RECIPIENT_ID,
        p_body: 'Can you send me $300?',
        p_mutation_disposition: expect.stringMatching(/^(allow|warn|deny)$/),
        p_escalate_case: expect.any(Boolean),
      })
    )
    const [, params] = rpc.mock.calls[0]
    expect(Array.isArray(params.p_reason_codes)).toBe(true)
  })

  it('returns 500 without leaking internals when the recording RPC fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: null, error: { message: 'db is down', code: '500' } })
    const { POST } = await import('./route')

    const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Hi there.' }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('db is down')
  })
})

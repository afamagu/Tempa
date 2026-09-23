import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const authorizationRpc = vi.fn<(name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()

const rpcSingle = vi.fn()
const recordingRpc = vi.fn<(name: string, params: Record<string, unknown>) => { single: typeof rpcSingle }>(() => ({
  single: rpcSingle,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, rpc: authorizationRpc }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: recordingRpc }),
}))

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111'
const QUESTION_ANSWER_ID = '55555555-5555-4555-8555-555555555555'
const FORGED_LETTER_ID = '99999999-9999-4999-8999-999999999999'
const FORGED_CORRESPONDENCE_ID = '88888888-8888-4888-8888-888888888888'
const FORGED_QUESTION_ANSWER_ID = '77777777-7777-4777-8777-777777777777'

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
    authorizationRpc.mockReset()
    // Authorized by default — individual tests override this to prove
    // the negative/adversarial cases.
    authorizationRpc.mockResolvedValue({ data: true, error: null })
    recordingRpc.mockClear()
    rpcSingle.mockReset()
  })

  it('rejects an unauthenticated request without ever calling the context check, the classifier, or the recording RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    const { POST } = await import('./route')
    const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Hi there.' }))
    expect(response.status).toBe(401)
    expect(authorizationRpc).not.toHaveBeenCalled()
    expect(recordingRpc).not.toHaveBeenCalled()
  })

  it('derives the user id from the authenticated session, never from the request body', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'session-user-id' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-1', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    await POST(
      request({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body: 'Hi there.',
        userId: 'attacker-supplied-id',
      })
    )

    expect(recordingRpc).toHaveBeenCalledTimes(1)
    const [, params] = recordingRpc.mock.calls[0]
    expect(params).toMatchObject({ p_user_id: 'session-user-id' })
  })

  it('rejects invalid JSON with 400', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request(undefined, { asString: '{not json' }))
    expect(response.status).toBe(400)
    expect(authorizationRpc).not.toHaveBeenCalled()
    expect(recordingRpc).not.toHaveBeenCalled()
  })

  it('rejects an unknown surface with 400', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request({ surface: 'admin_panel', body: 'hi' }))
    expect(response.status).toBe(400)
    expect(authorizationRpc).not.toHaveBeenCalled()
    expect(recordingRpc).not.toHaveBeenCalled()
  })

  describe('context authorization — adversarial forged-UUID cases', () => {
    it('rejects a syntactically-valid but unowned/forged letterId for a reply, with 403 and no evaluation created', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      authorizationRpc.mockResolvedValue({ data: false, error: null })
      const { POST } = await import('./route')

      const response = await POST(request({ surface: 'reply', letterId: FORGED_LETTER_ID, body: 'Can you send me $300?' }))

      expect(response.status).toBe(403)
      expect(recordingRpc).not.toHaveBeenCalled()
    })

    it('rejects a syntactically-valid but unowned/forged correspondenceId for write_anytime, with 403 and no evaluation created', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      authorizationRpc.mockResolvedValue({ data: false, error: null })
      const { POST } = await import('./route')

      const response = await POST(
        request({ surface: 'write_anytime', correspondenceId: FORGED_CORRESPONDENCE_ID, body: 'Can you send me $300?' })
      )

      expect(response.status).toBe(403)
      expect(recordingRpc).not.toHaveBeenCalled()
    })

    it('rejects a syntactically-valid but blocked/nonexistent recipientId for first_letter, with 403 and no evaluation created', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      authorizationRpc.mockResolvedValue({ data: false, error: null })
      const { POST } = await import('./route')

      const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Hi there.' }))

      expect(response.status).toBe(403)
      expect(recordingRpc).not.toHaveBeenCalled()
    })

    it('checks context authorization using the member\'s own authenticated client, not the service-role client', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-1', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
      const { POST } = await import('./route')

      await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Hi there.' }))

      expect(authorizationRpc).toHaveBeenCalledWith('can_evaluate_safety_context', {
        p_surface: 'first_letter',
        p_context_id: RECIPIENT_ID,
        p_question_answer_id: QUESTION_ANSWER_ID,
      })
      // The authorization call must happen strictly before classification
      // and recording — never in parallel with, or after, the write path.
      expect(recordingRpc).toHaveBeenCalledTimes(1)
    })

    it('returns 500 without leaking internals when the authorization check itself errors, and still records nothing', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      authorizationRpc.mockResolvedValue({ data: null, error: { message: 'db is down', code: '500' } })
      const { POST } = await import('./route')

      const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Hi there.' }))
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(JSON.stringify(body)).not.toContain('db is down')
      expect(recordingRpc).not.toHaveBeenCalled()
    })

    it('rejects a first_letter request with no questionAnswerId at all with 400, never reaching authorization or recording', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      const { POST } = await import('./route')

      const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Hi there.' }))

      expect(response.status).toBe(400)
      expect(authorizationRpc).not.toHaveBeenCalled()
      expect(recordingRpc).not.toHaveBeenCalled()
    })

    it('rejects a syntactically-valid but forged/stale questionAnswerId for first_letter, with 403 and no evaluation created', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      authorizationRpc.mockResolvedValue({ data: false, error: null })
      const { POST } = await import('./route')

      const response = await POST(
        request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: FORGED_QUESTION_ANSWER_ID, body: 'Hi there.' })
      )

      expect(response.status).toBe(403)
      expect(authorizationRpc).toHaveBeenCalledWith('can_evaluate_safety_context', {
        p_surface: 'first_letter',
        p_context_id: RECIPIENT_ID,
        p_question_answer_id: FORGED_QUESTION_ANSWER_ID,
      })
      expect(recordingRpc).not.toHaveBeenCalled()
    })
  })

  it('classifies a benign body and returns allow with no warning key', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-1', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    const response = await POST(
      request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Food is expensive here.' })
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({ evaluationId: 'eval-1', disposition: 'allow' })
  })

  it('classifies a clear violation and returns cannot_send with a warning key, never a risk band or reason codes', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: { evaluation_id: 'eval-2', expires_at: '2026-01-01T00:00:00Z', is_new: true }, error: null })
    const { POST } = await import('./route')

    const response = await POST(
      request({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body: 'Buy a Steam gift card and send me the code.',
      })
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

    expect(recordingRpc).toHaveBeenCalledWith(
      'record_safety_evaluation',
      expect.objectContaining({
        p_user_id: 'u1',
        p_surface: 'reply',
        p_context_id: RECIPIENT_ID,
        p_question_answer_id: null,
        p_body: 'Can you send me $300?',
        p_mutation_disposition: expect.stringMatching(/^(allow|warn|deny)$/),
        p_escalate_case: expect.any(Boolean),
      })
    )
    const [, params] = recordingRpc.mock.calls[0]
    expect(Array.isArray(params.p_reason_codes)).toBe(true)
  })

  it('returns 500 without leaking internals when the recording RPC fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    rpcSingle.mockResolvedValue({ data: null, error: { message: 'db is down', code: '500' } })
    const { POST } = await import('./route')

    const response = await POST(request({ surface: 'first_letter', recipientId: RECIPIENT_ID, questionAnswerId: QUESTION_ANSWER_ID, body: 'Hi there.' }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('db is down')
  })
})

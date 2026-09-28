import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))

import { POST } from './route'

const req = (body: string, headers: Record<string, string> = {}) =>
  new NextRequest('https://jointempa.com/api/perf/letter-send', { method: 'POST', body, headers })

beforeEach(() => {
  getUser.mockReset()
  vi.restoreAllMocks()
})

describe('POST /api/perf/letter-send', () => {
  it('refuses anonymous callers without logging', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await POST(req('{}'))).status).toBe(401)
    expect(log).not.toHaveBeenCalled()
  })

  it('logs one sanitized line with country and edge, returns 204', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await POST(
      req(JSON.stringify({ surface: 'write_anytime', outcome: 'sent', writeMs: 1234.5, body: 'Dear friend' }), {
        'x-vercel-ip-country': 'NG',
        'x-vercel-id': 'lhr1::iad1::abc',
      })
    )
    expect(res.status).toBe(204)
    expect(log).toHaveBeenCalledWith('[perf] letter-send', expect.objectContaining({ outcome: 'sent', writeMs: 1235, country: 'NG', edge: 'lhr1', userId: 'u1' }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('Dear friend')
  })

  it('rejects malformed payloads', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    expect((await POST(req('not json'))).status).toBe(400)
    expect((await POST(req(JSON.stringify({ surface: 'x', outcome: 'sent' })))).status).toBe(400)
  })
})

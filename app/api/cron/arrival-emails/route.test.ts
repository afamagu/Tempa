import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const runArrivalEmailWorker = vi.fn()
vi.mock('@/lib/email/arrival-worker', () => ({ runArrivalEmailWorker: (...args: unknown[]) => runArrivalEmailWorker(...args) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ __fake: 'service-client' }) }))
vi.mock('@/lib/email/provider', () => ({ sendEmail: vi.fn() }))

const ORIGINAL_ENV = { ...process.env }

function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://jointempa.com/api/cron/arrival-emails', {
    method: 'GET',
    headers,
  })
}

describe('GET/POST /api/cron/arrival-emails', () => {
  beforeEach(() => {
    vi.resetModules()
    runArrivalEmailWorker.mockReset()
    process.env = { ...ORIGINAL_ENV }
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_SITE_ORIGIN = 'https://jointempa.com'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects a request with no Authorization header', async () => {
    const { GET } = await import('./route')
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(runArrivalEmailWorker).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong bearer secret', async () => {
    const { GET } = await import('./route')
    const response = await GET(request({ authorization: 'Bearer wrong-secret' }))
    expect(response.status).toBe(401)
    expect(runArrivalEmailWorker).not.toHaveBeenCalled()
  })

  it('rejects every request when CRON_SECRET is not configured, even one that guesses "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const response = await GET(request({ authorization: 'Bearer undefined' }))
    expect(response.status).toBe(401)
  })

  it('500s when NEXT_PUBLIC_SITE_ORIGIN is missing, even with a correct secret', async () => {
    delete process.env.NEXT_PUBLIC_SITE_ORIGIN
    const { GET } = await import('./route')
    const response = await GET(request({ authorization: 'Bearer test-secret' }))
    expect(response.status).toBe(500)
    expect(runArrivalEmailWorker).not.toHaveBeenCalled()
  })

  it('runs the worker and returns its summary when authorized and configured (GET)', async () => {
    runArrivalEmailWorker.mockResolvedValue({ enqueued: 1, claimed: 1, sent: 1, skipped: 0, failed: 0, sendingEnabled: true })
    const { GET } = await import('./route')
    const response = await GET(request({ authorization: 'Bearer test-secret' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ enqueued: 1, claimed: 1, sent: 1, skipped: 0, failed: 0, sendingEnabled: true })
    expect(runArrivalEmailWorker).toHaveBeenCalledTimes(1)
  })

  it('POST is authorized the same way as GET', async () => {
    runArrivalEmailWorker.mockResolvedValue({ enqueued: 0, claimed: 0, sent: 0, skipped: 0, failed: 0, sendingEnabled: false })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://jointempa.com/api/cron/arrival-emails', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
      })
    )
    expect(response.status).toBe(200)
  })

  it('returns 500 without leaking internals when the worker throws', async () => {
    runArrivalEmailWorker.mockRejectedValue(new Error('supabase down'))
    const { GET } = await import('./route')
    const response = await GET(request({ authorization: 'Bearer test-secret' }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('supabase down')
  })
})

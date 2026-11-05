import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { createHmac } from 'node:crypto'
import { bachsSandboxConfig, createBachsSandboxCheckout, verifyBachsWebhook } from './bachs'

const secret = 'whsec_test'
const timestamp = '1793872800'
const body = '{"id":"evt_123","type":"collection.succeeded"}'
const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')
const input = {
  reference: 'TEMPA-' + 'A'.repeat(32),
  amountMinor: 1200,
  currency: 'USD',
  email: 'member@example.com',
  successUrl: 'https://preview.example.com/you/credits/return',
  cancelUrl: 'https://preview.example.com/you/credits',
}

afterEach(() => vi.unstubAllGlobals())

describe('Bachs sandbox configuration', () => {
  it('rejects absent and live keys', () => {
    expect(bachsSandboxConfig({} as NodeJS.ProcessEnv).ok).toBe(false)
    expect(bachsSandboxConfig({ BACHS_SANDBOX_SECRET_KEY: 'sk_live_abc' } as NodeJS.ProcessEnv).ok).toBe(false)
    expect(bachsSandboxConfig({ BACHS_SANDBOX_SECRET_KEY: 'sk_sandbox_abc' } as NodeJS.ProcessEnv).ok).toBe(true)
  })
})

describe('Bachs signed webhook', () => {
  it('accepts an authentic unmodified delivery within five minutes', () => {
    expect(verifyBachsWebhook(body, timestamp, signature, secret, Number(timestamp))).toBe(true)
  })
  it('rejects tampering, bad signatures, and stale deliveries', () => {
    expect(verifyBachsWebhook(body + ' ', timestamp, signature, secret, Number(timestamp))).toBe(false)
    expect(verifyBachsWebhook(body, timestamp, 'not-hex', secret, Number(timestamp))).toBe(false)
    expect(verifyBachsWebhook(body, timestamp, signature, secret, Number(timestamp) + 301)).toBe(false)
    expect(verifyBachsWebhook(body, timestamp, signature, secret, Number(timestamp) - 301)).toBe(false)
  })
})

describe('Bachs checkout adapter', () => {
  it('refuses a live key before making a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await createBachsSandboxCheckout('sk_live_bad', input)).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends only server-authoritative amount and reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checkout_id: 'chk_test123',
        checkout_url: 'https://checkout.bachs.io/c/token',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await createBachsSandboxCheckout('sk_sandbox_test', input)
    expect(result).toEqual({ ok: true, checkoutId: 'chk_test123', checkoutUrl: 'https://checkout.bachs.io/c/token' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://sandbox-api.bachs.io/v1/checkout-sessions')
    const sent = JSON.parse(options.body)
    expect(sent.pricing).toEqual({ currency: 'USD', amount: '12.00' })
    expect(sent.reference).toBe(input.reference)
    expect(sent.metadata.tempa_reference).toBe(input.reference)
  })
  it('refuses untrusted checkout redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_id: 'chk_123', checkout_url: 'https://evil.example/steal' }),
    }))
    expect((await createBachsSandboxCheckout('sk_sandbox_test', input)).ok).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('server-only', () => ({}))
const REF = 'TEMPA-' + 'A'.repeat(32)
const SECRET = 'whsec_sandbox_test'
const CHECKOUT = 'chk_test123'
const event = { id: 'evt_test123', type: 'collection.succeeded', data: {
  checkout_id: CHECKOUT, charge_id: 'ch_123', status: 'SUCCEEDED', amount: '12.00', currency: 'USD',
} }
const verified = { checkout_id: CHECKOUT, reference: REF, status: 'completed',
  payment_status: 'succeeded', amount: '12.00', currency: 'USD',
  charge: { payment_id: 'pay_123', status: 'succeeded', amount: '12.00', currency: 'USD' } }

let settleCalls: Record<string, unknown>[] = []
let ledgerCount = 0
let state: 'created' | 'paid' = 'created'
const seen = new Set<string>()
const service = {
  from: (table: string) => ({
    select: () => ({
      eq: (_field: string, value: string) => ({
        maybeSingle: async () => ({ data: table === 'commerce_bachs_checkouts' && value === CHECKOUT
          ? { checkout_id: CHECKOUT, order_id: 'order-1', reference: REF } : null, error: null }),
      }),
    }),
  }),
  rpc: async (_name: string, args: Record<string, unknown>) => {
    settleCalls.push(args)
    if (seen.has(String(args.p_event_id)) || state === 'paid') return {
      data: { outcome: 'duplicate', credited: false, order_state: state }, error: null,
    }
    seen.add(String(args.p_event_id))
    if (args.p_status === 'successful' && args.p_amount_minor === 1200 && args.p_currency === 'USD') {
      state = 'paid'; ledgerCount++
      return { data: { outcome: 'applied', credited: true, order_state: 'paid' }, error: null }
    }
    return { data: { outcome: 'rejected', credited: false, order_state: state }, error: null }
  },
}
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service }))
const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('BACHS_SANDBOX_SECRET_KEY', 'sk_sandbox_test')
  vi.stubEnv('BACHS_SANDBOX_WEBHOOK_SECRET', SECRET)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => verified })
  vi.stubGlobal('fetch', fetchMock)
  settleCalls = []; ledgerCount = 0; state = 'created'; seen.clear()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function deliver(payload: unknown, signatureValid = true) {
  const raw = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', SECRET).update(timestamp + '.' + raw).digest('hex')
  const { POST } = await import('@/app/api/payments/bachs/webhook/route')
  return POST(new Request('https://example.test/api/payments/bachs/webhook', {
    method: 'POST', body: raw, headers: {
      'x-bachs-timestamp': timestamp,
      'x-bachs-signature': signatureValid ? signature : 'f'.repeat(64),
    },
  }) as never)
}
describe('Bachs webhook security, settlement and duplicate protection', () => {
  it('rejects forged signatures without fetching provider data or touching the ledger', async () => {
    expect((await deliver(event, false)).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(settleCalls).toHaveLength(0)
  })
  it('verifies provider status and amount independently before settlement', async () => {
    expect((await deliver(event)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox-api.bachs.io/v1/checkout-sessions/' + CHECKOUT, expect.any(Object))
    expect(settleCalls[0]).toMatchObject({ p_provider: 'bachs', p_reference: REF,
      p_transaction_id: 'pay_123', p_status: 'successful', p_amount_minor: 1200, p_currency: 'USD' })
    expect(ledgerCount).toBe(1)
  })
  it('same webhook twice and a distinct event for the same charge grant Credits only once', async () => {
    expect((await deliver(event)).status).toBe(200)
    expect((await deliver(event)).status).toBe(200)
    expect((await deliver({ ...event, id: 'evt_another' })).status).toBe(200)
    expect(ledgerCount).toBe(1)
    expect(settleCalls).toHaveLength(3)
  })
  it('does not settle when provider status is pending', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      ...verified, status: 'open', payment_status: 'processing', charge: null,
    }) })
    expect((await deliver(event)).status).toBe(200)
    expect(settleCalls[0].p_status).toBe('pending')
    expect(ledgerCount).toBe(0)
  })
  it('refuses mismatched provider references and amounts', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...verified, reference: 'OTHER' }) })
    expect((await deliver(event)).status).toBe(500)
    expect(settleCalls).toHaveLength(0)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({
      ...verified, charge: { ...verified.charge, amount: '1.00' },
    }) })
    expect((await deliver(event)).status).toBe(500)
    expect(ledgerCount).toBe(0)
  })
})

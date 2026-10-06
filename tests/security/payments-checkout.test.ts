import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { formatMoney, majorToMinor, minorToMajorString } from '@/lib/money'
import {
  flutterwaveApiConfig,
  flutterwaveWebhookConfig,
  initializePayment,
  isFlutterwaveCheckoutUrl,
  normalizeStatus,
  parseVerification,
  verifyByReference,
  verifyTransaction,
  webhookSignatureValid,
} from '@/lib/payments/flutterwave'
import { settleVerified, settlementEventId } from '@/lib/payments/settlement'
import { checkoutReturnOrigin } from '@/lib/payments/return-origin'

// Commerce Checkpoint 5 — Flutterwave TEST MODE checkout. Security-relevant
// behaviour of the server layer: config/test-key guard, webhook signature,
// never trusting the browser or webhook body for money, exact minor units.

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const TEST = { secretKey: 'FLWSECK_TEST-abc123-X', webhookHash: 'tempa-webhook-hash-0001' }
const REF = 'TEMPA-' + 'A'.repeat(32)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('money: exact integer minor units', () => {
  it('formats minor units for the provider and refuses unknown currencies', () => {
    expect(minorToMajorString(750000, 'NGN')).toBe('7500.00')
    expect(minorToMajorString(5, 'USD')).toBe('0.05')
    expect(minorToMajorString(1500, 'UGX')).toBe('1500')
    expect(minorToMajorString(100, 'XYZ')).toBeNull()
    expect(minorToMajorString(0, 'USD')).toBeNull()
    expect(minorToMajorString(1.5, 'USD')).toBeNull()
  })

  it('reads provider amounts back exactly — a fractional minor unit is never rounded into a match', () => {
    expect(majorToMinor(7500, 'NGN')).toBe(750000)
    expect(majorToMinor('4.99', 'USD')).toBe(499)
    expect(majorToMinor(0.1 + 0.2, 'USD')).toBe(30)
    expect(majorToMinor(4.995, 'USD')).toBeNull()
    expect(majorToMinor(10.5, 'UGX')).toBeNull()
    expect(majorToMinor(-1, 'USD')).toBeNull()
    expect(majorToMinor('abc', 'USD')).toBeNull()
    expect(majorToMinor(10, 'XYZ')).toBeNull()
    expect(formatMoney(499, 'USD', 'en-US')).toBe('$4.99')
  })
})

describe('configuration: TEST MODE only, secrets server-side', () => {
  it('checkout needs only the test secret key; webhook config additionally needs the hash', () => {
    expect(flutterwaveApiConfig({} as NodeJS.ProcessEnv)).toEqual({ ok: false, reason: 'missing' })
    expect(flutterwaveApiConfig({ FLUTTERWAVE_SECRET_KEY: TEST.secretKey } as unknown as NodeJS.ProcessEnv))
      .toEqual({ ok: true, config: { secretKey: TEST.secretKey } })
    expect(flutterwaveWebhookConfig({ FLUTTERWAVE_SECRET_KEY: TEST.secretKey } as unknown as NodeJS.ProcessEnv))
      .toEqual({ ok: false, reason: 'missing' })
    expect(flutterwaveWebhookConfig({
      FLUTTERWAVE_SECRET_KEY: TEST.secretKey,
      FLUTTERWAVE_WEBHOOK_HASH: TEST.webhookHash,
    } as unknown as NodeJS.ProcessEnv))
      .toEqual({ ok: true, config: TEST })
  })

  it('refuses a live secret key in Checkpoint 5', () => {
    expect(flutterwaveApiConfig({ FLUTTERWAVE_SECRET_KEY: 'FLWSECK-live-key-X' } as unknown as NodeJS.ProcessEnv))
      .toEqual({ ok: false, reason: 'not_test_key' })
  })

  it('provider modules are server-only and never imported by client code; no Flutterwave secret is NEXT_PUBLIC', () => {
    expect(read('lib/payments/flutterwave.ts')).toMatch(/^import 'server-only'/)
    expect(read('lib/payments/settlement.ts')).toMatch(/^import 'server-only'/)
    const walk = (dir: string): string[] =>
      readdirSync(path.join(root, dir)).flatMap((n) => {
        const rel = path.join(dir, n)
        return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : []
      })
    for (const file of [...walk('app'), ...walk('lib')]) {
      const src = read(file)
      expect(src, file).not.toMatch(/NEXT_PUBLIC_FLUTTERWAVE/)
      if (/^\s*['"]use client['"]/.test(src)) expect(src, file).not.toMatch(/@\/lib\/payments\/(flutterwave|settlement)/)
    }
  })
})

describe('webhook signature (verif-hash)', () => {
  it('accepts only the exact secret hash', () => {
    expect(webhookSignatureValid(TEST, TEST.webhookHash)).toBe(true)
    expect(webhookSignatureValid(TEST, null)).toBe(false)
    expect(webhookSignatureValid(TEST, '')).toBe(false)
    expect(webhookSignatureValid(TEST, TEST.webhookHash + 'x')).toBe(false)
    expect(webhookSignatureValid(TEST, TEST.webhookHash.toUpperCase())).toBe(false)
  })
})

describe('provider verification', () => {
  const ok = (data: Record<string, unknown>) => ({ status: 'success', data: { id: 285959875, tx_ref: REF, status: 'successful', amount: 7500, currency: 'NGN', ...data } })

  it('parses only a successful verification response, with exact minor units', () => {
    expect(parseVerification(ok({}))).toEqual({ transactionId: '285959875', reference: REF, status: 'successful', amountMinor: 750000, currency: 'NGN' })
    expect(parseVerification({ status: 'error', data: ok({}).data })).toBeNull()
    expect(parseVerification({ status: 'success', data: { id: 1 } })).toBeNull()
    expect(parseVerification(null)).toBeNull()
    expect(parseVerification(ok({ amount: 7500.005 }))?.amountMinor).toBeNull()
  })

  it('normalizes statuses conservatively (anything unknown is pending, never success)', () => {
    expect(normalizeStatus('successful')).toBe('successful')
    expect(normalizeStatus('SUCCESSFUL')).toBe('successful')
    expect(normalizeStatus('failed')).toBe('failed')
    expect(normalizeStatus('cancelled')).toBe('cancelled')
    expect(normalizeStatus('success')).toBe('pending')
    expect(normalizeStatus('completed')).toBe('pending')
    expect(normalizeStatus(undefined)).toBe('pending')
  })

  it('calls the verify endpoint with the secret key; refuses malformed ids/references without calling', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok({})), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await verifyTransaction(TEST, '285959875')).toMatchObject({ status: 'successful', amountMinor: 750000 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.flutterwave.com/v3/transactions/285959875/verify')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST.secretKey}`)
    expect(await verifyTransaction(TEST, '../payments')).toBeNull()
    expect(await verifyByReference(TEST, 'not-a-tempa-ref')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a network failure or non-200 is unverifiable (never a success)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await verifyTransaction(TEST, '1')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await verifyTransaction(TEST, '1')).toBeNull()
  })
})

describe('checkout initialisation', () => {
  it('sends the ORDER’s server-side amount/currency/reference and returns only a Flutterwave-hosted link', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await initializePayment(TEST, { reference: REF, amountMinor: 750000, currency: 'NGN', email: 'm@example.com', redirectUrl: 'https://jointempa.com/you/credits/return', title: '500 Credits' })
    expect(r).toEqual({ ok: true, link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.flutterwave.com/v3/payments')
    const sent = JSON.parse(String(init.body))
    expect(sent).toMatchObject({ tx_ref: REF, amount: '7500.00', currency: 'NGN', redirect_url: 'https://jointempa.com/you/credits/return', customer: { email: 'm@example.com' } })
  })

  it('refuses any link that is not Flutterwave’s own https checkout', async () => {
    for (const link of ['https://evil.example/pay', 'http://checkout.flutterwave.com/x', 'https://flutterwave.com.evil.example/x', 'javascript:alert(1)']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: { link } }), { status: 200 })))
      expect(await initializePayment(TEST, { reference: REF, amountMinor: 100, currency: 'USD', email: 'm@example.com', redirectUrl: 'https://jointempa.com/x', title: 't' }), link).toMatchObject({ ok: false, reason: 'invalid_checkout_url' })
    }
    expect(isFlutterwaveCheckoutUrl('https://checkout-testing.flutterwave.com/v3/hosted/pay/x')).toBe(true)
    expect(isFlutterwaveCheckoutUrl('https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/x')).toBe(true)
    expect(isFlutterwaveCheckoutUrl('https://evil.dev-flutterwave.com/v3/hosted/pay/x')).toBe(false)
  })

  it('an unknown currency is never initialised', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await initializePayment(TEST, { reference: REF, amountMinor: 100, currency: 'XYZ', email: 'm@example.com', redirectUrl: 'https://jointempa.com/x', title: 't' })).toEqual({ ok: false, reason: 'invalid_amount', httpStatus: null, providerMessage: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a short provider rejection message in test mode without leaking secrets', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'error', message: 'This currency is not enabled for your account.' }),
      { status: 400 }
    ))
    vi.stubGlobal('fetch', fetchMock)
    expect(await initializePayment(TEST, {
      reference: REF,
      amountMinor: 1000,
      currency: 'ZAR',
      email: 'm@example.com',
      redirectUrl: 'https://jointempa.com/x',
      title: '300 Credits',
    })).toEqual({
      ok: false,
      reason: 'provider_rejected',
      httpStatus: 400,
      providerMessage: 'This currency is not enabled for your account.',
      checkoutHost: null,
    })
  })

  it('the member returns only to a known Tempa origin', () => {
    expect(checkoutReturnOrigin('https://jointempa.com', 'production')).toBe('https://jointempa.com')
    expect(checkoutReturnOrigin('https://tempa-git-feat-x-afam.vercel.app', 'production')).toBe('https://tempa-git-feat-x-afam.vercel.app')
    expect(checkoutReturnOrigin('https://evil.example', 'production')).toBe('https://jointempa.com')
    expect(checkoutReturnOrigin('https://tempa-x-afam.vercel.app.evil.example', 'production')).toBe('https://jointempa.com')
    expect(checkoutReturnOrigin('http://localhost:3000', 'production')).toBe('https://jointempa.com')
    expect(checkoutReturnOrigin('http://localhost:3000', 'development')).toBe('http://localhost:3000')
    expect(checkoutReturnOrigin(null, 'production')).toBe('https://jointempa.com')
  })
})

describe('settlement hand-off (verified data only)', () => {
  const verified = { transactionId: '285959875', reference: REF, status: 'successful' as const, amountMinor: 750000, currency: 'NGN' }

  it('passes the verified values and a replay-safe event id per source + transaction + status', async () => {
    const settle = vi.fn(async () => ({ data: { outcome: 'applied', credited: true, order_state: 'paid' }, error: null }))
    const r = await settleVerified(settle, verified, 'webhook', 'charge.completed', 'f'.repeat(64))
    expect(r).toEqual({ ok: true, outcome: 'applied', credited: true, orderState: 'paid', reference: REF })
    expect(settle).toHaveBeenCalledWith({
      p_provider: 'flutterwave', p_reference: REF, p_transaction_id: '285959875', p_status: 'successful', p_amount_minor: 750000,
      p_currency: 'NGN', p_event_id: 'webhook:285959875:successful', p_event_type: 'charge.completed', p_payload_sha256: 'f'.repeat(64),
    })
    expect(settlementEventId('return', verified)).toBe('return:285959875:successful')
  })

  it('an amount that is not whole minor units can never match (-1 is sent)', async () => {
    const settle = vi.fn(async () => ({ data: { outcome: 'rejected', credited: false, order_state: 'created' }, error: null }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await settleVerified(settle, { ...verified, amountMinor: null }, 'return', 'checkout.return', null)
    expect((settle.mock.calls[0] as unknown as [Record<string, unknown>])[0].p_amount_minor).toBe(-1)
  })

  it('a database failure is reported as settlement_failed and logs no amounts or payloads', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await settleVerified(async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }), verified, 'webhook', 'charge.completed', null)
    expect(r).toEqual({ ok: false, error: 'settlement_failed' })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/750000|FLWSECK|boom/)
  })
})

describe('webhook route', () => {
  const verifyAndSettle = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    verifyAndSettle.mockReset()
    vi.doMock('@/lib/payments/settlement', () => ({ verifyAndSettle }))
    vi.stubEnv('FLUTTERWAVE_SECRET_KEY', TEST.secretKey)
    vi.stubEnv('FLUTTERWAVE_WEBHOOK_HASH', TEST.webhookHash)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('@/lib/payments/settlement')
  })
  const post = async (body: unknown, hash: string | null = TEST.webhookHash) => {
    const { POST } = await import('@/app/api/payments/flutterwave/webhook/route')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (hash !== null) headers['verif-hash'] = hash
    return POST(new Request('https://jointempa.com/api/payments/flutterwave/webhook', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  }
  const charge = { event: 'charge.completed', data: { id: 285959875, tx_ref: REF, status: 'successful', amount: 7500, currency: 'NGN' } }

  it('refuses a missing or wrong signature without settling anything', async () => {
    expect((await post(charge, null)).status).toBe(401)
    expect((await post(charge, 'wrong')).status).toBe(401)
    expect(verifyAndSettle).not.toHaveBeenCalled()
  })

  it('refuses to run without configuration (503)', async () => {
    vi.stubEnv('FLUTTERWAVE_SECRET_KEY', '')
    expect((await post(charge)).status).toBe(503)
    expect(verifyAndSettle).not.toHaveBeenCalled()
  })

  it('ignores other events and malformed bodies (200, nothing settled)', async () => {
    expect((await post({ event: 'transfer.completed', data: { id: 1 } })).status).toBe(200)
    expect((await post('{not json')).status).toBe(200)
    expect((await post({ event: 'charge.completed', data: {} })).status).toBe(200)
    expect(verifyAndSettle).not.toHaveBeenCalled()
  })

  it('a signed charge.completed only NAMES the transaction: it is re-verified by id, and the body’s amount/status are never passed on', async () => {
    verifyAndSettle.mockResolvedValue({ ok: true, outcome: 'applied', credited: true, orderState: 'paid', reference: REF })
    const res = await post(charge)
    expect(res.status).toBe(200)
    const arg = verifyAndSettle.mock.calls[0][0]
    expect(arg).toMatchObject({ transactionId: '285959875', expectedReference: REF, source: 'webhook', eventType: 'charge.completed' })
    expect(Object.keys(arg).sort()).toEqual(['eventType', 'expectedReference', 'rawPayload', 'source', 'transactionId'])
  })

  it('duplicates are acknowledged (200); unverifiable/failed settlement asks Flutterwave to retry (500); a mismatched reference is not retried', async () => {
    verifyAndSettle.mockResolvedValue({ ok: true, outcome: 'duplicate', credited: false, orderState: 'paid', reference: REF })
    expect((await post(charge)).status).toBe(200)
    verifyAndSettle.mockResolvedValue({ ok: false, error: 'unverifiable' })
    expect((await post(charge)).status).toBe(500)
    verifyAndSettle.mockResolvedValue({ ok: false, error: 'settlement_failed' })
    expect((await post(charge)).status).toBe(500)
    verifyAndSettle.mockResolvedValue({ ok: false, error: 'reference_mismatch' })
    expect((await post(charge)).status).toBe(200)
  })

  it('refuses oversized bodies', async () => {
    expect((await post({ event: 'charge.completed', data: { id: 1 }, pad: 'x'.repeat(70 * 1024) })).status).toBe(413)
  })
})

describe('member flow wiring', () => {
  it('the return page checks the order is the member’s own BEFORE contacting the provider, and never trusts ?status=', () => {
    const page = read('app/you/credits/return/page.tsx')
    expect(page.indexOf('getMyOrder(supabase, reference)')).toBeLessThan(page.indexOf('verifyAndSettle('))
    expect(page).not.toMatch(/searchParams[\s\S]{0,80}status/)
    expect(page).toContain("source: 'return'")
  })

  it('the checkout action takes no amount, Credits or price from the browser and re-validates its arguments', () => {
    const action = read('app/you/credits/actions.ts')
    expect(action).toMatch(/export async function startCreditCheckout\(productId: unknown, currency: unknown, idempotencyKey: unknown\)/)
    expect(action).toContain("supabase.rpc('commerce_create_credit_order'")
    expect(action).toContain('amountMinor: Number(order.amount_minor)')
    expect(action).toContain("if (order.mode !== 'test') return unavailable()")
  })
})

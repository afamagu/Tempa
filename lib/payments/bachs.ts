import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { minorToMajorString, majorToMinor } from '@/lib/money'

/**
 * Bachs sandbox-only adapter. Deliberately not wired into member checkout:
 * Tempa's order creation/settlement RPCs still hardcode Flutterwave.
 * Never credit a wallet from a redirect or from an unverified webhook.
 */
const API = 'https://sandbox-api.bachs.io/v1'
const TIMEOUT_MS = 15_000
const MAX_SKEW_SECONDS = 300

export function bachsSandboxConfig(env: NodeJS.ProcessEnv = process.env):
  | { ok: true; secretKey: string }
  | { ok: false } {
  const secretKey = env.BACHS_SANDBOX_SECRET_KEY?.trim()
  if (!secretKey?.startsWith('sk_sandbox_')) return { ok: false }
  return { ok: true, secretKey }
}

/** Signed message is timestamp + "." + the exact raw UTF-8 body. */
export function verifyBachsWebhook(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!timestampHeader || !/^\d{10,}$/.test(timestampHeader) ||
      !signatureHeader || !/^[0-9a-f]{64}$/i.test(signatureHeader) || !secret) return false
  const timestamp = Number(timestampHeader)
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return false
  const expected = createHmac('sha256', secret)
    .update(timestampHeader + '.' + rawBody, 'utf8').digest()
  const received = Buffer.from(signatureHeader, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export type BachsCheckoutInput = {
  reference: string
  amountMinor: number
  currency: string
  email: string
  successUrl: string
  cancelUrl: string
}

export type BachsCheckoutResult =
  | { ok: true; checkoutId: string; checkoutUrl: string }
  | { ok: false; reason: 'invalid_input' | 'provider_rejected' | 'network_error' | 'invalid_response'; httpStatus?: number }

export async function createBachsSandboxCheckout(secretKey: string, input: BachsCheckoutInput): Promise<BachsCheckoutResult> {
  const amount = minorToMajorString(input.amountMinor, input.currency)
  if (!secretKey.startsWith('sk_sandbox_') || !/^TEMPA-[0-9A-F]{32}$/.test(input.reference) ||
      !amount || !/^[A-Z]{3}$/.test(input.currency) || !input.email.includes('@')) {
    return { ok: false, reason: 'invalid_input' }
  }
  try {
    const response = await fetch(API + '/checkout-sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricing: { currency: input.currency, amount },
        customer: { email: input.email },
        reference: input.reference,
        metadata: { tempa_reference: input.reference },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, reason: 'provider_rejected', httpStatus: response.status }
    const data: unknown = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid_response' }
    const { checkout_id: checkoutId, checkout_url: checkoutUrl } =
      data as { checkout_id?: unknown; checkout_url?: unknown }
    if (typeof checkoutId !== 'string' || !/^chk_[\w-]+$/.test(checkoutId) ||
        typeof checkoutUrl !== 'string') return { ok: false, reason: 'invalid_response' }
    const url = new URL(checkoutUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.bachs.io') {
      return { ok: false, reason: 'invalid_response' }
    }
    return { ok: true, checkoutId, checkoutUrl }
  } catch {
    return { ok: false, reason: 'network_error' }
  }
}

/** Provider-side verification: never settle from a redirect or webhook payload alone. */
export async function retrieveBachsSandboxCheckout(secretKey: string, checkoutId: string): Promise<{
  checkoutId: string; reference: string; status: 'successful' | 'failed' | 'cancelled' | 'pending';
  transactionId: string | null; amountMinor: number | null; currency: string
} | null> {
  if (!secretKey.startsWith('sk_sandbox_') || !/^chk_[A-Za-z0-9_-]+$/.test(checkoutId)) return null
  try {
    const res = await fetch(API + '/checkout-sessions/' + encodeURIComponent(checkoutId), {
      headers: { Authorization: 'Bearer ' + secretKey },
      cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const d: unknown = await res.json()
    if (!d || typeof d !== 'object') return null
    const x = d as Record<string, unknown>
    if (x.checkout_id !== checkoutId || typeof x.reference !== 'string' ||
        typeof x.currency !== 'string' || !/^[A-Z]{3}$/.test(x.currency)) return null
    const charge = x.charge && typeof x.charge === 'object' ? x.charge as Record<string, unknown> : null
    const lifecycle = String(x.status ?? '').toLowerCase()
    const payment = String(x.payment_status ?? '').toLowerCase()
    const chargeStatus = String(charge?.status ?? '').toLowerCase()
    // Require all success indicators and a provider payment ID; otherwise fail closed.
    const successful = lifecycle === 'completed' && payment === 'succeeded' && chargeStatus === 'succeeded'
    const status = successful ? 'successful' : lifecycle === 'cancelled' ? 'cancelled'
      : lifecycle === 'expired' || payment === 'failed' ? 'failed' : 'pending'
    // The charge must agree with the checkout's base amount/currency, not only its status.
    const chargeMatches = !!charge && charge.currency === x.currency &&
      majorToMinor(charge.amount, x.currency as string) === majorToMinor(x.amount, x.currency as string)
    const transactionId = successful && chargeMatches && typeof charge?.payment_id === 'string' && /^pay_[A-Za-z0-9_-]+$/.test(charge.payment_id)
      ? charge.payment_id : null
    if (successful && !transactionId) return null
    return { checkoutId, reference: x.reference, status, transactionId,
      amountMinor: majorToMinor(x.amount, x.currency), currency: x.currency }
  } catch { return null }
}

import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { minorToMajorString } from '@/lib/money'

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

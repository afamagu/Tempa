import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { majorToMinor, minorToMajorString } from '@/lib/money'

/**
 * Commerce Checkpoint 5 — Flutterwave (Standard, v3), TEST MODE ONLY.
 *
 * Server-only. The secret key and webhook hash come from the environment
 * and never reach the browser, logs or the database. Checkpoint 5 refuses
 * to run with anything but a Flutterwave TEST secret key (FLWSECK_TEST-…):
 * live payments are a later, explicit launch gate.
 *
 * Nothing a browser or webhook body says is trusted for money: every
 * settlement is preceded by GET /v3/transactions/{id}/verify with the
 * secret key, and only that verified status/amount/currency/tx_ref is used
 * (Flutterwave's own guidance).
 */

const API = 'https://api.flutterwave.com/v3'
const TIMEOUT_MS = 15_000

export type FlutterwaveApiConfig = { secretKey: string }
export type FlutterwaveWebhookConfig = FlutterwaveApiConfig & { webhookHash: string }

export type FlutterwaveConfigState<T> =
  | { ok: true; config: T }
  | { ok: false; reason: 'missing' | 'not_test_key' }

export function flutterwaveApiConfig(
  env: NodeJS.ProcessEnv = process.env
): FlutterwaveConfigState<FlutterwaveApiConfig> {
  const secretKey = env.FLUTTERWAVE_SECRET_KEY?.trim()
  if (!secretKey) return { ok: false, reason: 'missing' }
  if (!secretKey.startsWith('FLWSECK_TEST-')) return { ok: false, reason: 'not_test_key' }
  return { ok: true, config: { secretKey } }
}

export function flutterwaveWebhookConfig(
  env: NodeJS.ProcessEnv = process.env
): FlutterwaveConfigState<FlutterwaveWebhookConfig> {
  const api = flutterwaveApiConfig(env)
  if (!api.ok) return api
  const webhookHash = env.FLUTTERWAVE_WEBHOOK_HASH?.trim()
  if (!webhookHash) return { ok: false, reason: 'missing' }
  return { ok: true, config: { ...api.config, webhookHash } }
}

export type PaymentStatus = 'successful' | 'failed' | 'cancelled' | 'pending'

export function normalizeStatus(raw: unknown): PaymentStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (s === 'successful') return 'successful'
  if (s === 'failed' || s === 'error') return 'failed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'pending'
}

export type VerifiedTransaction = {
  transactionId: string
  reference: string
  status: PaymentStatus
  /** null when Flutterwave reported an amount that isn't a whole number of minor units */
  amountMinor: number | null
  currency: string
}

/** Constant-time comparison of the `verif-hash` header with our secret hash. */
export function webhookSignatureValid(config: FlutterwaveWebhookConfig, header: string | null): boolean {
  if (!header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(config.webhookHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function call(config: FlutterwaveApiConfig, path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.json().catch(() => null)
    return res.ok ? body : null
  } catch {
    return null
  }
}

export function parseVerification(body: unknown): VerifiedTransaction | null {
  const b = body as { status?: string; data?: Record<string, unknown> } | null
  const d = b?.data
  if (b?.status !== 'success' || !d || d.id == null || typeof d.tx_ref !== 'string' || typeof d.currency !== 'string') return null
  const currency = d.currency.toUpperCase()
  return {
    transactionId: String(d.id),
    reference: d.tx_ref,
    status: normalizeStatus(d.status),
    amountMinor: majorToMinor(d.amount, currency),
    currency,
  }
}

export async function verifyTransaction(config: FlutterwaveApiConfig, transactionId: string): Promise<VerifiedTransaction | null> {
  if (!/^\d{1,20}$/.test(transactionId)) return null
  return parseVerification(await call(config, `/transactions/${transactionId}/verify`))
}

export async function verifyByReference(config: FlutterwaveApiConfig, reference: string): Promise<VerifiedTransaction | null> {
  if (!/^TEMPA-[0-9A-F]{32}$/.test(reference)) return null
  return parseVerification(await call(config, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`))
}

/** Flutterwave's hosted checkout lives on its own domain (test mode may use
 * a different checkout subdomain); a member is only ever sent there. */
export function isFlutterwaveCheckoutUrl(link: string): boolean {
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:') return false

    const host = url.hostname.toLowerCase()
    return (
      host === 'flutterwave.com' ||
      host.endsWith('.flutterwave.com') ||
      host === 'checkout-v2.dev-flutterwave.com'
    )
  } catch {
    return false
  }
}

export type FlutterwaveCheckoutInit =
  | { ok: true; link: string }
  | {
      ok: false
      reason: 'invalid_amount' | 'provider_rejected' | 'invalid_checkout_url' | 'network_error'
      httpStatus: number | null
      providerMessage: string | null
      checkoutHost: string | null
    }

function safeProviderMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { message?: unknown }).message
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, 240) : null
}

export async function initializePayment(
  config: FlutterwaveApiConfig,
  input: { reference: string; amountMinor: number; currency: string; email: string; redirectUrl: string; title: string }
): Promise<FlutterwaveCheckoutInit> {
  const amount = minorToMajorString(input.amountMinor, input.currency)
  if (!amount) {
    return { ok: false, reason: 'invalid_amount', httpStatus: null, providerMessage: null, checkoutHost: null }
  }

  try {
    const res = await fetch(`${API}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        tx_ref: input.reference,
        amount,
        currency: input.currency,
        redirect_url: input.redirectUrl,
        customer: { email: input.email },
        customizations: { title: 'Tempa', description: input.title },
        meta: { tempa_reference: input.reference },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const body = (await res.json().catch(() => null)) as {
      status?: string
      message?: string
      data?: { link?: string }
    } | null
    const providerMessage = safeProviderMessage(body)

    if (!res.ok || body?.status !== 'success') {
      return {
        ok: false,
        reason: 'provider_rejected',
        httpStatus: res.status,
        providerMessage,
        checkoutHost: null,
      }
    }

    const link = body.data?.link
    if (!link || !isFlutterwaveCheckoutUrl(link)) {
      let checkoutHost: string | null = null
      if (typeof link === 'string') {
        try {
          checkoutHost = new URL(link).hostname || null
        } catch {
          checkoutHost = null
        }
      }
      return {
        ok: false,
        reason: 'invalid_checkout_url',
        httpStatus: res.status,
        providerMessage,
        checkoutHost,
      }
    }

    return { ok: true, link }
  } catch {
    return {
      ok: false,
      reason: 'network_error',
      httpStatus: null,
      providerMessage: null,
      checkoutHost: null,
    }
  }
}


export type FlutterwaveConnectionCheck =
  | { ok: true; status: 'connected' }
  | { ok: false; status: 'missing_config' | 'wrong_key_type' | 'unauthorized' | 'provider_error' }

/**
 * Read-only credential probe for Admin → Commerce diagnostics.
 * It never creates a charge and never returns provider data: it performs an
 * authenticated transaction-list request for today's date and keeps only the
 * HTTP status. 200 proves the v3 test secret can authenticate.
 */
export async function testFlutterwaveConnection(
  env: NodeJS.ProcessEnv = process.env
): Promise<FlutterwaveConnectionCheck> {
  const cfg = flutterwaveApiConfig(env)
  if (!cfg.ok) {
    return {
      ok: false,
      status: cfg.reason === 'not_test_key' ? 'wrong_key_type' : 'missing_config',
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  try {
    const res = await fetch(
      `${API}/transactions?from=${today}&to=${today}&page=1`,
      {
        headers: {
          Authorization: `Bearer ${cfg.config.secretKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    if (res.ok) return { ok: true, status: 'connected' }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 'unauthorized' }
    }
    return { ok: false, status: 'provider_error' }
  } catch {
    return { ok: false, status: 'provider_error' }
  }
}

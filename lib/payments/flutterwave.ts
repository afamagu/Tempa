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

export type FlutterwaveConfig = { secretKey: string; webhookHash: string }

export type FlutterwaveConfigState =
  | { ok: true; config: FlutterwaveConfig }
  | { ok: false; reason: 'missing' | 'not_test_key' }

export function flutterwaveConfig(env: NodeJS.ProcessEnv = process.env): FlutterwaveConfigState {
  const secretKey = env.FLUTTERWAVE_SECRET_KEY?.trim()
  const webhookHash = env.FLUTTERWAVE_WEBHOOK_HASH?.trim()
  if (!secretKey || !webhookHash) return { ok: false, reason: 'missing' }
  if (!secretKey.startsWith('FLWSECK_TEST-')) return { ok: false, reason: 'not_test_key' }
  return { ok: true, config: { secretKey, webhookHash } }
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
export function webhookSignatureValid(config: FlutterwaveConfig, header: string | null): boolean {
  if (!header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(config.webhookHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function call(config: FlutterwaveConfig, path: string, init?: RequestInit): Promise<unknown | null> {
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

export async function verifyTransaction(config: FlutterwaveConfig, transactionId: string): Promise<VerifiedTransaction | null> {
  if (!/^\d{1,20}$/.test(transactionId)) return null
  return parseVerification(await call(config, `/transactions/${transactionId}/verify`))
}

export async function verifyByReference(config: FlutterwaveConfig, reference: string): Promise<VerifiedTransaction | null> {
  if (!/^TEMPA-[0-9A-F]{32}$/.test(reference)) return null
  return parseVerification(await call(config, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`))
}

/** Flutterwave's hosted checkout lives on its own domain (test mode may use
 * a different checkout subdomain); a member is only ever sent there. */
export function isFlutterwaveCheckoutUrl(link: string): boolean {
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && (url.hostname === 'flutterwave.com' || url.hostname.endsWith('.flutterwave.com'))
  } catch {
    return false
  }
}

export async function initializePayment(
  config: FlutterwaveConfig,
  input: { reference: string; amountMinor: number; currency: string; email: string; redirectUrl: string; title: string }
): Promise<{ link: string } | null> {
  const amount = minorToMajorString(input.amountMinor, input.currency)
  if (!amount) return null
  const body = (await call(config, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: input.reference,
      amount,
      currency: input.currency,
      redirect_url: input.redirectUrl,
      customer: { email: input.email },
      customizations: { title: 'Tempa', description: input.title },
      meta: { tempa_reference: input.reference },
    }),
  })) as { status?: string; data?: { link?: string } } | null
  const link = body?.status === 'success' ? body.data?.link : undefined
  return link && isFlutterwaveCheckoutUrl(link) ? { link } : null
}

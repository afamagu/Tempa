import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { flutterwaveConfig, verifyByReference, verifyTransaction, type VerifiedTransaction } from './flutterwave'

/**
 * Commerce Checkpoint 5 — the ONE path from a payment signal to Credits.
 *
 * A webhook or a member returning from checkout only tells us WHICH
 * transaction to look at. We then ask Flutterwave's API (secret key) for
 * that transaction and pass only the verified status / amount / currency /
 * tx_ref to public.commerce_settle_payment (service role only), which
 * records the event once, locks the order, checks the amount and currency
 * exactly and writes at most one credit_purchase ledger entry.
 *
 * Never logs tokens, keys, card data or payloads — only the Tempa
 * reference, provider transaction id and outcome.
 */

export type SettlementSource = 'webhook' | 'return'

export type SettlementResult =
  | { ok: true; outcome: 'applied' | 'duplicate' | 'rejected'; credited: boolean; orderState: string | null; reference: string }
  | { ok: false; error: 'not_configured' | 'unverifiable' | 'reference_mismatch' | 'settlement_failed' }

export function payloadDigest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function settlementEventId(source: SettlementSource, verified: VerifiedTransaction): string {
  return `${source}:${verified.transactionId}:${verified.status}`
}

type Settle = (args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>

export async function settleVerified(
  settle: Settle,
  verified: VerifiedTransaction,
  source: SettlementSource,
  eventType: string,
  payloadSha256: string | null
): Promise<SettlementResult> {
  const { data, error } = await settle({
    p_provider: 'flutterwave',
    p_reference: verified.reference,
    p_transaction_id: verified.transactionId,
    p_status: verified.status,
    // An amount that isn't a whole number of minor units can never match.
    p_amount_minor: verified.amountMinor ?? -1,
    p_currency: verified.currency,
    p_event_id: settlementEventId(source, verified),
    p_event_type: eventType,
    p_payload_sha256: payloadSha256,
  })
  if (error || !data) {
    console.error('[payments] settlement failed', { reference: verified.reference, transactionId: verified.transactionId, code: error?.code ?? null })
    return { ok: false, error: 'settlement_failed' }
  }
  const r = data as { outcome: 'applied' | 'duplicate' | 'rejected'; credited: boolean; order_state: string | null }
  if (r.outcome === 'rejected') {
    console.warn('[payments] settlement rejected', { reference: verified.reference, transactionId: verified.transactionId })
  }
  return { ok: true, outcome: r.outcome, credited: r.credited, orderState: r.order_state, reference: verified.reference }
}

/**
 * Verify with Flutterwave, then settle. `expectedReference` (the tx_ref the
 * browser came back with) must equal the verified tx_ref — a member cannot
 * point one order's return at another transaction.
 */
export async function verifyAndSettle(input: {
  transactionId?: string | null
  expectedReference?: string | null
  source: SettlementSource
  eventType: string
  rawPayload?: string | null
}): Promise<SettlementResult> {
  const cfg = flutterwaveConfig()
  if (!cfg.ok) return { ok: false, error: 'not_configured' }

  const verified = input.transactionId
    ? await verifyTransaction(cfg.config, input.transactionId)
    : input.expectedReference
      ? await verifyByReference(cfg.config, input.expectedReference)
      : null
  if (!verified) return { ok: false, error: 'unverifiable' }
  if (input.expectedReference && verified.reference !== input.expectedReference) return { ok: false, error: 'reference_mismatch' }

  const service = createServiceClient()
  return settleVerified(
    (args) => service.rpc('commerce_settle_payment', args),
    verified,
    input.source,
    input.eventType,
    input.rawPayload ? payloadDigest(input.rawPayload) : null
  )
}

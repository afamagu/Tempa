import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { bachsSandboxConfig, retrieveBachsSandboxCheckout } from './bachs'
import { payloadDigest } from './settlement'

const CHECKOUT = /^chk_[A-Za-z0-9_-]+$/
const REFERENCE = /^TEMPA-[0-9A-F]{32}$/

/** Authenticated provider lookup + server-side session binding are mandatory. */
export async function verifyAndSettleBachs(input: {
  checkoutId: string; expectedReference?: string | null; eventId: string; eventType: string; rawPayload?: string
}): Promise<{ ok: boolean; outcome?: string; reason?: string }> {
  const config = bachsSandboxConfig()
  if (!config.ok || !CHECKOUT.test(input.checkoutId)) return { ok: false, reason: 'not_configured' }
  const service = createServiceClient()
  const { data: binding, error: bindError } = await service.from('commerce_bachs_checkouts')
    .select('checkout_id,order_id,reference').eq('checkout_id', input.checkoutId).maybeSingle()
  if (bindError || !binding || !REFERENCE.test(binding.reference) ||
      (input.expectedReference && input.expectedReference !== binding.reference)) {
    return { ok: false, reason: 'binding_mismatch' }
  }
  const verified = await retrieveBachsSandboxCheckout(config.secretKey, input.checkoutId)
  if (!verified || verified.reference !== binding.reference) return { ok: false, reason: 'unverifiable' }
  // The existing settlement RPC requires a nonempty transaction ID for successful charges.
  // Other statuses are recorded without ever granting Credits.
  const { data, error } = await service.rpc('commerce_settle_payment', {
    p_provider: 'bachs', p_reference: binding.reference,
    p_transaction_id: verified.transactionId,
    p_status: verified.status, p_amount_minor: verified.amountMinor ?? -1,
    p_currency: verified.currency,
    p_event_id: input.eventId.slice(0, 190),
    p_event_type: input.eventType,
    p_payload_sha256: input.rawPayload ? payloadDigest(input.rawPayload) : null,
  })
  if (error || !data) {
    console.error('[payments] Bachs settlement failed', { reference: binding.reference, code: error?.code ?? null })
    return { ok: false, reason: 'settlement_failed' }
  }
  return { ok: true, outcome: (data as { outcome: string }).outcome }
}

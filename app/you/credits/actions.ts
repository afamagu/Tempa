'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { commerceError, COMMERCE_ERROR_COPY } from '@/lib/commerce'
import { checkoutReturnOrigin } from '@/lib/payments/return-origin'
import { flutterwaveApiConfig, initializePayment } from '@/lib/payments/flutterwave'
import { bachsSandboxConfig, createBachsSandboxCheckout } from '@/lib/payments/bachs'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Commerce Checkpoint 5 — start a Credits checkout (Flutterwave TEST MODE).
 *
 * The member names only a pack, a currency and one idempotency key per
 * intent. commerce_create_credit_order (under the member's own session)
 * applies every gate — account, provider, test mode, member switches or
 * tester allowlist, market, currency, THEN the published price — and
 * snapshots the order. Flutterwave is then initialised with the ORDER's
 * server-side amount/currency/reference; nothing here takes a price from
 * the browser. A Server Action is directly invocable, so every argument is
 * re-validated at runtime.
 */

export type StartCheckoutResult =
  | { status: 'redirect'; url: string }
  | { status: 'already_paid'; reference: string }
  | { status: 'error'; message: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable = (): StartCheckoutResult => ({ status: 'error', message: COMMERCE_ERROR_COPY.checkout_disabled })

export async function startCreditCheckout(productId: unknown, currency: unknown, idempotencyKey: unknown): Promise<StartCheckoutResult> {
  if (typeof productId !== 'string' || !UUID.test(productId) || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)
      || typeof idempotencyKey !== 'string') {
    return { status: 'error', message: COMMERCE_ERROR_COPY.invalid_request }
  }
  const bachs = bachsSandboxConfig()
  const service = createServiceClient()
  const { data: bachsProvider } = await service.from('commerce_payment_providers').select('checkout_enabled,live_mode_enabled').eq('code', 'bachs').maybeSingle()
  const useBachs = bachs.ok && bachsProvider?.checkout_enabled === true && bachsProvider.live_mode_enabled === false
  const cfg = flutterwaveApiConfig()
  if (!useBachs && !cfg.ok) return unavailable()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { status: 'error', message: COMMERCE_ERROR_COPY.not_authorized }

  const { data, error } = await supabase.rpc(useBachs ? 'commerce_create_credit_order_for_provider' : 'commerce_create_credit_order', {
    p_product_id: productId,
    p_currency: currency,
    p_idempotency_key: idempotencyKey,
    ...(useBachs ? { p_provider: 'bachs' } : {}),
  })
  if (error || !data) return { status: 'error', message: commerceError(error).message }

  const order = data as { order_id: string; reference: string; state: string; amount_minor: number | string; currency: string; product: string; mode: string; provider?: string }
  if (order.state === 'paid') return { status: 'already_paid', reference: order.reference }
  if (order.mode !== 'test') return unavailable()

  const origin = checkoutReturnOrigin((await headers()).get('origin'))
  if (useBachs) {
    if (!bachs.ok || order.provider !== 'bachs') return unavailable()
    const init = await createBachsSandboxCheckout(bachs.secretKey, {
      reference: order.reference, amountMinor: Number(order.amount_minor), currency: order.currency,
      email: user.email, successUrl: `${origin}/you/credits/return?tx_ref=${encodeURIComponent(order.reference)}`,
      cancelUrl: `${origin}/you/credits`,
    })
    if (!init.ok) return { status: 'error', message: 'We couldn’t open the payment page. Please try again.' }
    const { error: bindError } = await service.from('commerce_bachs_checkouts').insert({
      checkout_id: init.checkoutId, order_id: order.order_id, reference: order.reference,
    })
    if (bindError) {
      const { data: existing } = await service.from('commerce_bachs_checkouts')
        .select('order_id,reference').eq('checkout_id', init.checkoutId).maybeSingle()
      if (existing?.order_id !== order.order_id || existing?.reference !== order.reference) {
        console.error('[payments] Bachs checkout binding failed', { reference: order.reference, code: bindError.code })
        return { status: 'error', message: 'We couldn’t prepare checkout securely. Please try again.' }
      }
    }
    return { status: 'redirect', url: init.checkoutUrl }
  }
  if (!cfg.ok) return unavailable()
  const init = await initializePayment(cfg.config, {
    reference: order.reference,
    amountMinor: Number(order.amount_minor),
    currency: order.currency,
    email: user.email,
    redirectUrl: `${origin}/you/credits/return`,
    title: order.product,
  })
  if (!init.ok) {
    console.error('[payments] checkout initialisation failed', {
      reference: order.reference,
      reason: init.reason,
      httpStatus: init.httpStatus,
    })
    const providerDetail =
      order.mode === 'test' && init.providerMessage
        ? ` Flutterwave says: ${init.providerMessage}.`
        : ''
    const diagnosticDetail =
      order.mode === 'test'
        ? ` Tempa classified this as ${init.reason}${init.checkoutHost ? ` (host: ${init.checkoutHost})` : ''}.`
        : ''
    return {
      status: 'error',
      message: `We couldn’t open the payment page.${providerDetail}${diagnosticDetail || ' Please try again in a moment.'}`,
    }
  }
  return { status: 'redirect', url: init.link }
}

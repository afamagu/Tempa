'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { commerceError, COMMERCE_ERROR_COPY } from '@/lib/commerce'
import { checkoutReturnOrigin } from '@/lib/payments/return-origin'
import { flutterwaveApiConfig, initializePayment } from '@/lib/payments/flutterwave'

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
  const cfg = flutterwaveApiConfig()
  if (!cfg.ok) return unavailable()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { status: 'error', message: COMMERCE_ERROR_COPY.not_authorized }

  const { data, error } = await supabase.rpc('commerce_create_credit_order', {
    p_product_id: productId,
    p_currency: currency,
    p_idempotency_key: idempotencyKey,
  })
  if (error || !data) return { status: 'error', message: commerceError(error).message }

  const order = data as { reference: string; state: string; amount_minor: number | string; currency: string; product: string; mode: string }
  if (order.state === 'paid') return { status: 'already_paid', reference: order.reference }
  if (order.mode !== 'test') return unavailable()

  const origin = checkoutReturnOrigin((await headers()).get('origin'))
  const init = await initializePayment(cfg.config, {
    reference: order.reference,
    amountMinor: Number(order.amount_minor),
    currency: order.currency,
    email: user.email,
    redirectUrl: `${origin}/you/credits/return`,
    title: order.product,
  })
  if (!init) {
    console.error('[payments] checkout initialisation failed', { reference: order.reference })
    return { status: 'error', message: 'We couldn’t open the payment page. Please try again in a moment.' }
  }
  return { status: 'redirect', url: init.link }
}

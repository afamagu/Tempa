import { NextResponse } from 'next/server'
import { flutterwaveConfig, webhookSignatureValid } from '@/lib/payments/flutterwave'
import { verifyAndSettle } from '@/lib/payments/settlement'

/**
 * Commerce Checkpoint 5 — Flutterwave webhook (TEST MODE).
 *
 * 1. The `verif-hash` header must equal our secret hash (constant-time);
 *    anything else is refused without reading further.
 * 2. The body only names a transaction. Its status/amount/currency/tx_ref
 *    are re-read from Flutterwave's API before anything is settled
 *    (lib/payments/settlement.ts), so a forged or replayed body cannot
 *    issue Credits; replays are recorded once and ignored.
 * 3. 200 once handled (including duplicates and ignored events) so
 *    Flutterwave stops retrying; 500 only when verification or settlement
 *    could not complete, so Flutterwave retries later.
 * Never logs the payload, the hash or any key.
 */

const MAX_BYTES = 64 * 1024

export async function POST(request: Request) {
  const cfg = flutterwaveConfig()
  if (!cfg.ok) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  if (!webhookSignatureValid(cfg.config, request.headers.get('verif-hash'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }

  const raw = await request.text()
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })

  let body: { event?: unknown; data?: { id?: unknown; tx_ref?: unknown } } | null = null
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  const event = typeof body?.event === 'string' ? body.event : null
  const transactionId = body?.data?.id != null ? String(body.data.id) : null
  if (event !== 'charge.completed' || !transactionId) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  const result = await verifyAndSettle({
    transactionId,
    expectedReference: typeof body?.data?.tx_ref === 'string' ? body.data.tx_ref : null,
    source: 'webhook',
    eventType: event,
    rawPayload: raw,
  }).catch(() => ({ ok: false as const, error: 'settlement_failed' as const }))

  if (!result.ok) {
    // reference_mismatch is a malformed/forged body: nothing to retry.
    const retry = result.error === 'unverifiable' || result.error === 'settlement_failed' || result.error === 'not_configured'
    return NextResponse.json({ status: 'not_settled' }, { status: retry ? 500 : 200 })
  }
  return NextResponse.json({ status: result.outcome }, { status: 200 })
}

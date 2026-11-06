import { NextRequest, NextResponse } from 'next/server'
import { verifyBachsWebhook } from '@/lib/payments/bachs'
import { verifyAndSettleBachs } from '@/lib/payments/bachs-settlement'

export const runtime = 'nodejs'
const MAX_BYTES = 65536
export async function POST(request: NextRequest) {
  const secret = process.env.BACHS_SANDBOX_WEBHOOK_SECRET?.trim()
  if (!secret) return NextResponse.json({ status: 'unavailable' }, { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ status: 'too_large' }, { status: 413 })
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return NextResponse.json({ status: 'too_large' }, { status: 413 })
  if (!verifyBachsWebhook(raw, request.headers.get('x-bachs-timestamp'), request.headers.get('x-bachs-signature'), secret))
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 })
  let event: { id?: unknown; type?: unknown; data?: { checkout_id?: unknown } }
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ status: 'invalid' }, { status: 400 }) }
  if (event.type !== 'collection.succeeded' || typeof event.id !== 'string' ||
      !/^evt_[A-Za-z0-9_-]+$/.test(event.id) || typeof event.data?.checkout_id !== 'string')
    return NextResponse.json({ status: 'ignored' })
  const result = await verifyAndSettleBachs({
    checkoutId: event.data.checkout_id, eventId: event.id,
    eventType: event.type, rawPayload: raw,
  })
  if (!result.ok) return NextResponse.json({ status: 'not_settled' }, { status: 500 })
  return NextResponse.json({ status: result.outcome })
}

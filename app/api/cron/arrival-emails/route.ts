import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { runArrivalEmailWorker } from '@/lib/email/arrival-worker'
import { sendEmail } from '@/lib/email/provider'

/**
 * Scheduler entrypoint for the arrival-email worker. Vercel Cron calls
 * this with GET and an `Authorization: Bearer $CRON_SECRET` header
 * (set automatically from the project's CRON_SECRET env var); POST is
 * also accepted for a manual trigger or an external scheduler, same
 * auth. No other route in this app requires a bearer secret — this one
 * has no user session to check, so the secret comparison below is the
 * entire authorization boundary, done in constant time to avoid a
 * timing side-channel on the secret itself.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const headerBuf = Buffer.from(header)
  const expectedBuf = Buffer.from(expected)
  if (headerBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(headerBuf, expectedBuf)
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN
  if (!siteOrigin) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_ORIGIN is not configured.' }, { status: 500 })
  }

  try {
    const summary = await runArrivalEmailWorker({
      supabase: createServiceClient(),
      sendEmail,
      siteOrigin,
      artOrigin: process.env.ARRIVAL_EMAIL_ART_ORIGIN || null,
    })
    return NextResponse.json(summary)
  } catch (error) {
    console.error('arrival-emails cron run failed', error)
    return NextResponse.json({ error: 'Worker run failed.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

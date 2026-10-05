import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { runArrivalEmailWorker } from '@/lib/email/arrival-worker'
import { runRoomInvitationEmailWorker } from '@/lib/email/room-invitation-worker'
import { runMentionEmailWorker } from '@/lib/email/mention-worker'
import { runReplyReminderEmailWorker } from '@/lib/email/reply-reminder-worker'
import { sendEmail } from '@/lib/email/provider'

/**
 * Scheduler entrypoint for Tempa's mail workers. Vercel Cron calls this with
 * GET and an `Authorization: Bearer $CRON_SECRET` header (set automatically
 * from the project's CRON_SECRET env var); POST is also accepted for a manual
 * trigger or external scheduler, same auth. The comparison is constant-time.
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

    await runRoomInvitationEmailWorker({ supabase: createServiceClient(), sendEmail, siteOrigin })

    // Optional queues must never change the success of core letter delivery.
    try {
      await runMentionEmailWorker({ supabase: createServiceClient(), sendEmail, siteOrigin })
    } catch {
      console.error('Mention email worker unavailable')
    }

    // Phase 8 is deliberately fail-isolated during forward deployment: before
    // its migration lands, a missing RPC/table cannot break arrival emails.
    // enqueue_reply_reminders still runs whenever this worker is available,
    // even while its own provider kill switch is OFF, because the enqueue also
    // powers the quiet in-app Letterbox reminders.
    try {
      await runReplyReminderEmailWorker({
        supabase: createServiceClient(),
        sendEmail,
        siteOrigin,
      })
    } catch (error) {
      console.error('Reply reminder worker unavailable', error)
    }

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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeLetterSendTiming } from '@/lib/letter-send-timing-sanitize'

// Receives lib/letter-send-timing.ts reports and writes ONE structured log
// line per Send (Vercel logs: search "[perf] letter-send"). Durations,
// outcome, country and edge only — no letter content, no ids beyond the
// signed-in member's own user id. Off the send's critical path (beacon
// after the fact); refuses anonymous callers and anything malformed.

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  let raw: unknown
  try {
    raw = JSON.parse(await request.text())
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  const timing = sanitizeLetterSendTiming(raw)
  if (!timing) return new NextResponse(null, { status: 400 })

  console.info('[perf] letter-send', {
    ...timing,
    userId: user.id,
    country: request.headers.get('x-vercel-ip-country'),
    edge: request.headers.get('x-vercel-id')?.split('::')[0] ?? null,
  })
  return new NextResponse(null, { status: 204 })
}

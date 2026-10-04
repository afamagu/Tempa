import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runMentionEmailWorker } from '@/lib/email/mention-worker'
import { sendEmail } from '@/lib/email/provider'
import { SITE_URL } from '@/lib/site'

export async function POST(request: Request) {
  // Browser wake-up only; never accept a sender, recipient or payload from input.
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response(null, { status: 403 })
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return new Response(null, { status: 401 })
  after(async () => {
    try {
      await runMentionEmailWorker({ supabase: createServiceClient(), sendEmail, siteOrigin: SITE_URL, senderId: user.id })
    } catch { console.error('Immediate mention email attempt unavailable; scheduled fallback retained') }
  })
  return new Response(null, { status: 202 })
}

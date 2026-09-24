'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePostAuthDestination } from '@/lib/post-auth-destination'
import type { MagicLinkOtpType } from '@/lib/auth-confirm'

/**
 * Cross-browser magic-link fix (2026-09-24) — the ONE place a magic-link
 * token is actually consumed. Bound with the server-extracted
 * `tokenHash`/`type`/`next` (see app/auth/confirm/page.tsx — Next.js
 * Server Action closures encrypt bound arguments, so the token is never
 * rendered as plaintext in the page's own HTML/DOM the way the previous
 * `<a href>` design embedded it), and invoked only by the "Sign in to
 * TEMPA" form's own explicit submit — never by GETting /auth/confirm,
 * never by any client-side effect/timer/auto-navigation.
 *
 * Calls supabase.auth.verifyOtp with the server (cookie-bound) client,
 * NOT the service-role client — this is what establishes the session
 * cookies in the browser/device that is actually viewing this page,
 * with no PKCE code/code_verifier of any kind involved. Same trust
 * model as send_first_letter/write_letter/etc. throughout this codebase:
 * the token is single-use because GoTrue itself enforces that, not
 * because this function does.
 *
 * Never logs the token, never persists it, never includes it in an
 * error message — only the SDK error's own message/code/name (same
 * restrained shape app/auth/callback/route.ts's own logging already
 * uses), and only server-side.
 */
export async function verifyMagicLink(tokenHash: string, type: MagicLinkOtpType, next: string | null) {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error || !data.user) {
    if (error) {
      console.error('[auth/confirm] verifyOtp failed', {
        message: error.message,
        code: error.code,
        name: error.name,
      })
    }
    redirect('/sign-in?error=link_expired')
  }

  const destination = await resolvePostAuthDestination(supabase, data.user.id, next ?? '/home')
  redirect(destination)
}

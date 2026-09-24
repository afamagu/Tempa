import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { resolvePostAuthDestination } from '@/lib/post-auth-destination'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  // Return-to-requested-page after sign-in (pre-beta UX polish batch 1)
  // — re-validated HERE, server-side, regardless of where this `next`
  // came from: this is the actual security boundary, since anyone can
  // craft their own callback URL with an arbitrary `next` value,
  // whether or not this app's own sign-in page happened to generate it.
  const next = sanitizeInternalPath(searchParams.get('next'))

  if (oauthError) {
    console.error('[auth/callback] provider returned an error', {
      error: oauthError,
      description: searchParams.get('error_description'),
    })
    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // `next` is honored only after the complete durable account-entry
      // sequence: confirmed adult eligibility, current legal
      // acceptance, THEN the existing profile-onboarding sequence. A
      // profile row alone no longer proves completion, and neither does
      // a profile stage of 'complete' on its own. Shared with the email
      // magic-link verification action (app/auth/confirm/verify-magic-
      // link-action.ts) via lib/post-auth-destination.ts, so there is
      // never a second, subtly different definition of where an
      // authenticated member belongs.
      const requestedDestination = next ?? '/home'
      const destination = await resolvePostAuthDestination(supabase, data.user.id, requestedDestination)

      return NextResponse.redirect(`${origin}${destination}`)
    }

    if (error) {
      console.error('[auth/callback] code exchange failed', {
        message: error.message,
        code: error.code,
        name: error.name,
      })
    }

    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  // Checkpoint 1, Phase A blind spot — until now, landing here with
  // NEITHER `code` NOR a query-string `error` produced zero server-side
  // log output at all. This is exactly what happens when GoTrue's own
  // token verification fails (e.g. `otp_expired`): it redirects here
  // with the real error only in the URL FRAGMENT (`#error=...`), which
  // browsers never send to the server — see app/sign-in/page.tsx's own
  // getAuthErrorMessageFromFragment for where that fragment IS read,
  // client-side. Deliberately logs only a fixed reason tag, the NAMES
  // (never values) of whatever query params were present, and a plain
  // COUNT of PKCE-verifier-shaped cookies (never their values) — enough
  // to distinguish "GoTrue rejected the token before ever issuing a
  // code" from other failure shapes, without ever logging an auth code,
  // a token, a session, or cookie contents.
  const cookieStore = await cookies()
  const verifierCookieCount = cookieStore.getAll().filter((c) => c.name.includes('code-verifier')).length
  console.error('[auth/callback] auth_callback_no_code_no_query_error', {
    reason: 'auth_callback_no_code_no_query_error',
    paramNames: Array.from(searchParams.keys()),
    verifierCookieCount,
  })

  return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
}

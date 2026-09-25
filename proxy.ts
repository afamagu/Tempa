import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { resolveAccountEntryDestination } from '@/lib/account-entry'
import { readProxyAccountEntry } from '@/lib/account-entry-state'

/**
 * Return-to-requested-page after sign-in (pre-beta UX polish batch 1) —
 * the ONLY place a logged-out visit to a protected route is turned into
 * `/sign-in?next=<path>` (see app/sign-in/page.tsx and
 * app/auth/callback/route.ts for where `next` is consumed after a
 * successful sign-in). Scoped to `/admin/:path*` for now — the one
 * route this checkpoint actually needs it for — but the redirect shape
 * itself (`next` = the exact requested pathname+search) generalizes to
 * any other protected route this matcher grows to cover later.
 *
 * This is convenience only, never the authorization boundary: every
 * protected route (app/admin/layout.tsx, is_staff() inside each admin
 * RPC) re-checks auth/authorization itself, server-side, independent of
 * this Proxy ever having run — see the Next.js Proxy docs' own warning
 * that a matcher change can silently drop coverage.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const signInUrl = new URL('/sign-in', request.url)
    signInUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(signInUrl)
  }

  // Permanent ban + Adult Eligibility + Legal Acceptance + onboarding
  // gate, read in ONE self-scoped round trip (current_account_entry_state
  // — see lib/account-entry-state.ts). Read live through the member's own
  // session on every request (never cached), so a ban takes effect on the
  // very next navigation. A banned account resolves to the
  // account-unavailable notice; the database still refuses every write
  // for a banned account regardless.
  const { accountStatus, state } = await readProxyAccountEntry(supabase, user.id)
  if (accountStatus === 'banned') {
    return NextResponse.redirect(new URL('/account-unavailable', request.url))
  }

  const requestedDestination = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const destination = resolveAccountEntryDestination(state, requestedDestination)

  if (destination === '/begin') {
    const beginUrl = new URL('/begin', request.url)
    beginUrl.searchParams.set('next', requestedDestination)
    return NextResponse.redirect(beginUrl)
  }

  if (destination !== requestedDestination) {
    return NextResponse.redirect(new URL(destination, request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/announcement/:path*',
    '/board/:path*',
    '/home/:path*',
    '/letters/:path*',
    '/minds/:path*',
    '/profile/:path*',
    '/question/:path*',
    '/write/:path*',
    '/you/:path*',
  ],
}

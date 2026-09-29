import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { resolveAccountEntryDestination } from '@/lib/account-entry'
import { readProxyAccountEntry } from '@/lib/account-entry-state'
import { buildCsp, generateNonce, originOf } from '@/lib/security/csp'
import { serverCookieOptions } from '@/lib/supabase/cookie-options'

/**
 * Return-to-requested-page after sign-in (pre-beta UX polish batch 1) —
 * the ONLY place a logged-out visit to a protected route is turned into
 * `/sign-in?next=<path>` (see app/sign-in/page.tsx and
 * app/auth/callback/route.ts for where `next` is consumed after a
 * successful sign-in).
 *
 * This is convenience only, never the authorization boundary: every
 * protected route (app/admin/layout.tsx, is_staff() inside each admin
 * RPC) re-checks auth/authorization itself, server-side, independent of
 * this Proxy ever having run — see the Next.js Proxy docs' own warning
 * that a matcher change can silently drop coverage.
 *
 * Pre-beta security F-02 — the Proxy also runs on every HTML route (see
 * `config.matcher`) to attach a per-request nonce + Content-Security-
 * Policy. Only the paths in PROTECTED_MATCHERS go through the auth /
 * account-entry gate below; every other route (the public `/` landing
 * page, sign-in, legal pages, shared Dispatches, account-state notices)
 * just gets the CSP headers and no Supabase call. The root page itself
 * still checks auth so an existing member is sent straight into Tempa.
 */
export const PROTECTED_MATCHERS = [
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
] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_MATCHERS.some((m) => {
    const prefix = m.replace('/:path*', '')
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  })
}

// Report-Only until reports from production have been reviewed; flip to
// true to enforce (same policy, header name changes).
const CSP_ENFORCE = false
const CSP_HEADER = CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

export async function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCsp({
    nonce,
    supabaseOrigins: [originOf(process.env.NEXT_PUBLIC_SUPABASE_URL)].filter((o): o is string => Boolean(o)),
    isDev: process.env.NODE_ENV === 'development',
    enforce: CSP_ENFORCE,
  })

  // Next.js reads the nonce from the request's CSP header and applies it to
  // its own scripts; the same policy goes on the response for the browser.
  const withCspRequest = () => {
    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set(CSP_HEADER, csp)
    return NextResponse.next({ request: { headers } })
  }
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set(CSP_HEADER, csp)
    return res
  }

  if (!isProtectedPath(request.nextUrl.pathname)) {
    return withCsp(withCspRequest())
  }

  let response = withCspRequest()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: serverCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = withCspRequest()
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
    return withCsp(NextResponse.redirect(signInUrl))
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
    return withCsp(NextResponse.redirect(new URL('/account-unavailable', request.url)))
  }
  // Account lifecycle (docs/sql/2026-10-16-account-lifecycle.sql) — a
  // member taking a break lands on the calm paused page (never silently
  // reactivated); a closed account's leftover session goes to the
  // deletion confirmation, never the ban notice.
  if (accountStatus === 'deactivated') {
    return withCsp(NextResponse.redirect(new URL('/account-paused', request.url)))
  }
  if (accountStatus === 'closed') {
    return withCsp(NextResponse.redirect(new URL('/account-deleted', request.url)))
  }

  const requestedDestination = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const destination = resolveAccountEntryDestination(state, requestedDestination)

  if (destination === '/begin') {
    const beginUrl = new URL('/begin', request.url)
    beginUrl.searchParams.set('next', requestedDestination)
    return withCsp(NextResponse.redirect(beginUrl))
  }

  if (destination !== requestedDestination) {
    return withCsp(NextResponse.redirect(new URL(destination, request.url)))
  }

  return withCsp(response)
}

export const config = {
  // Every HTML route (CSP), excluding API routes, Next.js assets and static
  // files by extension (public images, manifest, robots, sitemap,
  // security.txt, icons, /postcards/*.jpg|mp4 …) — an explicit list, so a
  // protected path that merely contains a dot is still gated. Link
  // prefetches are deliberately NOT excluded: the
  // auth / account-entry gate has always run on prefetches of protected
  // routes, and still does. Which routes are AUTH-GATED is decided by
  // PROTECTED_MATCHERS above, not by this matcher.
  matcher: ['/((?!api/|_next/static|_next/image|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|webmanifest|txt|xml|woff2?|map)$).*)'],
}

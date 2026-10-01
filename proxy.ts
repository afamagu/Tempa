import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/i18n/config'
import { resolveAccountEntryDestination } from '@/lib/account-entry'
import { readProxyAccountEntry } from '@/lib/account-entry-state'
import { buildCsp, generateNonce, originOf } from '@/lib/security/csp'
import { serverCookieOptions } from '@/lib/supabase/cookie-options'

/**
 * Return-to-requested-page + CSP + durable account-entry gate.
 * Language confirmation now precedes every other setup step, while a saved
 * authenticated interface locale is synchronized back to the device cookie
 * so the member keeps the same Tempa language across browsers/devices after
 * sign-in. Country/IP are never consulted.
 */
export const PROTECTED_MATCHERS = [
  '/admin/:path*',
  '/announcement/:path*',
  '/begin/:path*',
  '/board/:path*',
  '/home/:path*',
  '/language/:path*',
  '/letters/:path*',
  '/minds/:path*',
  '/profile/:path*',
  '/question/:path*',
  '/room/:path*',
  '/write/:path*',
  '/you/:path*',
] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_MATCHERS.some((m) => {
    const prefix = m.replace('/:path*', '')
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  })
}

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

  let response: NextResponse | undefined
  const withCspRequest = () => {
    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set(CSP_HEADER, csp)
    const next = NextResponse.next({ request: { headers } })
    response?.cookies.getAll().forEach((cookie) => next.cookies.set(cookie))
    return next
  }
  const withCsp = <T extends NextResponse>(res: T): T => {
    if (response && res !== response) response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    res.headers.set(CSP_HEADER, csp)
    return res
  }

  if (!isProtectedPath(request.nextUrl.pathname)) return withCsp(withCspRequest())

  response = withCspRequest()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: serverCookieOptions(),
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = withCspRequest()
          cookiesToSet.forEach(({ name, value, options }) => response!.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const signInUrl = new URL('/sign-in', request.url)
    signInUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return withCsp(NextResponse.redirect(signInUrl))
  }

  const { accountStatus, state, interfaceLocale } = await readProxyAccountEntry(supabase, user.id)

  if (interfaceLocale && request.cookies.get(LOCALE_COOKIE)?.value !== interfaceLocale) {
    request.cookies.set(LOCALE_COOKIE, interfaceLocale)
    response = withCspRequest()
    response.cookies.set(LOCALE_COOKIE, interfaceLocale, {
      path: '/',
      sameSite: 'lax',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
  }

  if (accountStatus === 'banned') return withCsp(NextResponse.redirect(new URL('/account-unavailable', request.url)))
  if (accountStatus === 'deactivated') return withCsp(NextResponse.redirect(new URL('/account-paused', request.url)))
  if (accountStatus === 'closed') return withCsp(NextResponse.redirect(new URL('/account-deleted', request.url)))

  const requestedDestination = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const destination = resolveAccountEntryDestination(state, requestedDestination)

  if (destination === '/begin') {
    // /begin itself is now protected so a saved authenticated locale is
    // synchronized before the DOB/legal UI renders. Let that route through
    // when it is already the required gate; otherwise preserve the original
    // requested page in `next` for the normal post-gate return.
    if (request.nextUrl.pathname === '/begin') return withCsp(response!)
    const beginUrl = new URL('/begin', request.url)
    beginUrl.searchParams.set('next', requestedDestination)
    return withCsp(NextResponse.redirect(beginUrl))
  }

  if (destination !== requestedDestination) return withCsp(NextResponse.redirect(new URL(destination, request.url)))
  return withCsp(response!)
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|webmanifest|txt|xml|woff2?|map)$).*)'],
}

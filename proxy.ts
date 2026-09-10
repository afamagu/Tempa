import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

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

  return response
}

export const config = {
  matcher: ['/admin/:path*'],
}

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { type OnboardingStage } from '@/lib/onboarding'
import { resolveAccountEntryDestination, type EligibilityStatus } from '@/lib/account-entry'
import { isLegalCurrent } from '@/lib/legal'

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

  // Adult Eligibility + Legal Acceptance Gate — an authenticated
  // account without confirmed eligibility or current legal acceptance
  // must not reach any protected route by direct navigation, exactly
  // like an incomplete profile already cannot. Three small independent
  // reads (own-row RLS on each), same shape as the existing profiles
  // read below — matches this file's own established "query inline,
  // share only the pure resolver" pattern (see lib/account-entry.ts).
  const [{ data: profile }, { data: eligibility }, { data: legalRows }] = await Promise.all([
    supabase.from('profiles').select('id, onboarding_stage').eq('id', user.id).maybeSingle(),
    supabase.from('account_eligibility').select('status').eq('user_id', user.id).maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', user.id),
  ])

  const requestedDestination = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const destination = resolveAccountEntryDestination(
    {
      authenticated: true,
      eligibilityStatus: (eligibility?.status as EligibilityStatus | undefined) ?? null,
      eligibleOn: null,
      legalCurrent: isLegalCurrent(
        (legalRows ?? []).map((r) => ({
          documentType: r.document_type as 'terms_of_service' | 'community_guidelines',
          documentVersion: r.document_version as string,
        }))
      ),
      hasProfile: Boolean(profile),
      onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
    },
    requestedDestination
  )

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

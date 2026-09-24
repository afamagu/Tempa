import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAccountEntryDestination, type EligibilityStatus } from '@/lib/account-entry'
import { isLegalCurrent } from '@/lib/legal'
import { type OnboardingStage } from '@/lib/onboarding'

/**
 * Cross-browser magic-link fix (2026-09-24) — the ONE place that turns
 * "a user id just got a fresh session" into "where should they land."
 * Extracted from app/auth/callback/route.ts's own inline sequence
 * (unchanged in substance — same three parallel queries, same
 * resolveAccountEntryDestination call, same /begin?next= special case)
 * so the Google/OAuth PKCE callback and the email magic-link
 * verification action share exactly one definition of account-entry
 * routing, never two subtly different ones. Returns a relative path
 * (e.g. '/home', '/begin?next=%2Fletters', '/profile/mark') — each
 * caller decides whether to prefix it with its own origin.
 */
export async function resolvePostAuthDestination(
  supabase: SupabaseClient,
  userId: string,
  requestedDestination: string
): Promise<string> {
  const [{ data: profile }, { data: eligibility }, { data: legalRows }] = await Promise.all([
    supabase.from('profiles').select('id, onboarding_stage').eq('id', userId).maybeSingle(),
    supabase.from('account_eligibility').select('status').eq('user_id', userId).maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', userId),
  ])

  const destination = resolveAccountEntryDestination(
    {
      authenticated: true,
      eligibilityStatus: (eligibility?.status as EligibilityStatus | undefined) ?? null,
      eligibleOn: null,
      legalCurrent: isLegalCurrent(
        (legalRows ?? []).map((r: { document_type: string; document_version: string }) => ({
          documentType: r.document_type as 'terms_of_service' | 'community_guidelines',
          documentVersion: r.document_version,
        }))
      ),
      hasProfile: Boolean(profile),
      onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
    },
    requestedDestination
  )

  if (destination === '/begin') {
    const beginUrl = new URL('/begin', 'https://tempa-internal.invalid')
    beginUrl.searchParams.set('next', requestedDestination)
    return `${beginUrl.pathname}${beginUrl.search}`
  }

  return destination
}

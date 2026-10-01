import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAccountEntryDestination, type EligibilityStatus } from '@/lib/account-entry'
import { isLegalCurrent } from '@/lib/legal'
import { type OnboardingStage } from '@/lib/onboarding'

/**
 * The ONE post-auth destination resolver shared by OAuth, email magic-link
 * verification and GIS. Language confirmation now precedes DOB/legal/profile
 * onboarding. A missing language migration fails open so deploy ordering is
 * safe; once SQL is applied, a brand-new account has no confirmed row and is
 * sent to /language first.
 */
export async function resolvePostAuthDestination(
  supabase: SupabaseClient,
  userId: string,
  requestedDestination: string
): Promise<string> {
  const [
    { data: profile },
    { data: eligibility },
    { data: legalRows },
    languageResult,
  ] = await Promise.all([
    supabase.from('profiles').select('id, onboarding_stage').eq('id', userId).maybeSingle(),
    supabase.from('account_eligibility').select('status').eq('user_id', userId).maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', userId),
    supabase
      .from('member_language_preferences')
      .select('language_confirmed_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const languageConfirmed = languageResult.error
    ? undefined
    : Boolean((languageResult.data as { language_confirmed_at?: string | null } | null)?.language_confirmed_at)

  const destination = resolveAccountEntryDestination(
    {
      authenticated: true,
      languageConfirmed,
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

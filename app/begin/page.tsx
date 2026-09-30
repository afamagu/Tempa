import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { resolveAccountEntryDestination, type EligibilityStatus } from '@/lib/account-entry'
import { isLegalCurrent } from '@/lib/legal'
import type { OnboardingStage } from '@/lib/onboarding'
import BeginFlow from './begin-flow'
import { signOutAndReturnToSignIn } from './sign-out-action'

/** Adult eligibility + legal acceptance gate. Language confirmation is now
 * earlier in account entry, so a direct /begin visit also yields to /language
 * until that first decision has been explicitly confirmed. */
export default async function BeginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const rawNext = resolvedSearchParams.next
  const next = sanitizeInternalPath(typeof rawNext === 'string' ? rawNext : null)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const signInNext = next ? `/begin?next=${encodeURIComponent(next)}` : '/begin'
    redirect(`/sign-in?next=${encodeURIComponent(signInNext)}`)
  }

  const [
    { data: profile },
    { data: eligibility },
    { data: legalRows },
    languageResult,
  ] = await Promise.all([
    supabase.from('profiles').select('id, onboarding_stage').eq('id', user.id).maybeSingle(),
    supabase
      .from('account_eligibility')
      .select('status, eligible_on')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', user.id),
    supabase
      .from('member_language_preferences')
      .select('language_confirmed_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const eligibilityStatus = (eligibility?.status as EligibilityStatus | undefined) ?? null
  const legalCurrent = isLegalCurrent(
    (legalRows ?? []).map((r) => ({
      documentType: r.document_type as 'terms_of_service' | 'community_guidelines',
      documentVersion: r.document_version as string,
    }))
  )
  const languageConfirmed = languageResult.error
    ? undefined
    : Boolean((languageResult.data as { language_confirmed_at?: string | null } | null)?.language_confirmed_at)

  const destination = resolveAccountEntryDestination(
    {
      authenticated: true,
      languageConfirmed,
      eligibilityStatus,
      eligibleOn: eligibility?.eligible_on ?? null,
      legalCurrent,
      hasProfile: Boolean(profile),
      onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
    },
    next ?? '/home'
  )

  if (destination !== '/begin') {
    redirect(destination)
  }

  const today = new Date().toISOString().slice(0, 10)
  const stillBlocked = eligibilityStatus === 'ineligible' && Boolean(eligibility?.eligible_on) && eligibility!.eligible_on! > today

  return (
    <BeginFlow
      eligibilityStatus={eligibilityStatus}
      stillBlocked={stillBlocked}
      showLegalStep={eligibilityStatus === 'eligible' && !legalCurrent}
      signOutAction={signOutAndReturnToSignIn}
      eligibleOn={eligibility?.eligible_on ?? null}
    />
  )
}

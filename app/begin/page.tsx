import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { resolveAccountEntryDestination, type EligibilityStatus } from '@/lib/account-entry'
import { isLegalCurrent } from '@/lib/legal'
import type { OnboardingStage } from '@/lib/onboarding'
import BeginFlow from './begin-flow'

/**
 * Adult Eligibility + Legal Acceptance Gate — the account-entry
 * surface, deliberately outside AppShell (Section on /begin's own
 * styling: no app navigation, no giant corporate card, quiet and
 * editorial). Reached either by proxy.ts/auth/callback redirecting an
 * authenticated-but-incomplete account here with `?next=<requested>`,
 * or by a direct visit. Performs its own authenticated server-state
 * check rather than being forced through the Proxy matcher — simpler,
 * and avoids any possibility of a matcher-driven redirect loop since
 * `/begin` is never itself one of proxy.ts's matched paths.
 */
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

  const [{ data: profile }, { data: eligibility }, { data: legalRows }] = await Promise.all([
    supabase.from('profiles').select('id, onboarding_stage').eq('id', user.id).maybeSingle(),
    supabase
      .from('account_eligibility')
      .select('status, eligible_on')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', user.id),
  ])

  const eligibilityStatus = (eligibility?.status as EligibilityStatus | undefined) ?? null
  const legalCurrent = isLegalCurrent(
    (legalRows ?? []).map((r) => ({
      documentType: r.document_type as 'terms_of_service' | 'community_guidelines',
      documentVersion: r.document_version as string,
    }))
  )

  const destination = resolveAccountEntryDestination(
    {
      authenticated: true,
      eligibilityStatus,
      eligibleOn: eligibility?.eligible_on ?? null,
      legalCurrent,
      hasProfile: Boolean(profile),
      onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
    },
    next ?? '/home'
  )

  // The gate is already satisfied (or a race/refresh caught up) —
  // never linger on /begin once there is nothing left to do here.
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
    />
  )
}

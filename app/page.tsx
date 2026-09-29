import { redirect } from 'next/navigation'
import LandingPage from './landing-page'
import { createClient } from '@/lib/supabase/server'
import { resolveOnboardingDestination, type OnboardingStage } from '@/lib/onboarding'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // `/` is Tempa's public front door. Existing members still pass straight
  // through the same account/onboarding resolver below; signed-out visitors
  // see the editorial landing page instead of being bounced to auth before
  // they have had a chance to understand the product.
  if (!user) return <LandingPage />

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  redirect(
    resolveOnboardingDestination(
      {
        authenticated: true,
        hasProfile: Boolean(profile),
        onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
      },
      '/home'
    )
  )
}

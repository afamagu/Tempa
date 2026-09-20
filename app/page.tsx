import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveOnboardingDestination, type OnboardingStage } from '@/lib/onboarding'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

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

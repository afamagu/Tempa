import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileForm from './profile-form'
import type { OnboardingStage } from '@/lib/onboarding'

export default async function ProfileSetupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  if (existingProfile) {
    const stage = existingProfile.onboarding_stage as OnboardingStage
    if (stage === 'mark') redirect('/profile/mark')
    if (stage === 'question') redirect('/profile/question')
    redirect('/home')
  }

  return <ProfileForm userId={user.id} />
}

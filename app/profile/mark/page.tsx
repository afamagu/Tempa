import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import YourMarkStep from './your-mark-step'

export default async function YourMarkPage() {
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

  if (!profile) redirect('/profile')
  if (profile.onboarding_stage === 'question') redirect('/profile/question')
  if (profile.onboarding_stage === 'complete') redirect('/home')

  return <YourMarkStep />
}


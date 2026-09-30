import { redirect } from 'next/navigation'
import LandingPage from './landing-page'
import { createClient } from '@/lib/supabase/server'
import { resolvePostAuthDestination } from '@/lib/post-auth-destination'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return <LandingPage />

  // Use the same durable account-entry sequence as every sign-in path.
  // This includes the language-first gate, eligibility/legal checks, profile
  // onboarding and Writing Style rather than maintaining a weaker root-only
  // definition of "ready for Home".
  redirect(await resolvePostAuthDestination(supabase, user.id, '/home'))
}

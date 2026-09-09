import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayMomentsGuide from './replay'

export default async function ReplayMomentsGuidePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return <ReplayMomentsGuide />
}

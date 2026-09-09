import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayMindsGuide from './replay'

export default async function ReplayMindsGuidePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return <ReplayMindsGuide />
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GuidedLetterJourney from './guided-letter-journey'

export default async function GuidedBoardLetterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const { data: profile } = await supabase.from('profiles').select('id, mark_id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/profile')
  if (!profile.mark_id) redirect('/you/mark')
  return <GuidedLetterJourney userId={user.id} />
}

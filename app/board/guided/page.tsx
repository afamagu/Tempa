import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import AppShell from '@/app/app-shell'
import GuidedFirstLetter from '../guided-first-letter'

export default async function GuidedOpenLetterPage({ searchParams }: { searchParams: Promise<{ firstArrival?: string }> }) {
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)redirect('/sign-in?next=%2Fboard%2Fguided')
  const [{ data: profile }, waitingCount, params] = await Promise.all([
    supabase.from('profiles').select('first_arrival_journey_version, first_letter_invitation_done_at').eq('id',user.id).maybeSingle(),
    getWaitingLetterCount(supabase,user.id),
    searchParams,
  ])
  const firstArrival = params.firstArrival === '1' && profile?.first_arrival_journey_version === 2 && !profile.first_letter_invitation_done_at
  return <AppShell active="board" waitingLetterCount={waitingCount}>
    <GuidedFirstLetter userId={user.id} firstArrival={firstArrival}/>
  </AppShell>
}

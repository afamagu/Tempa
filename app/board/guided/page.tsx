import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import AppShell from '@/app/app-shell'
import GuidedFirstLetter from '../guided-first-letter'

export default async function GuidedOpenLetterPage() {
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)redirect('/sign-in?next=%2Fboard%2Fguided')
  const waitingCount=await getWaitingLetterCount(supabase,user.id)
  return <AppShell active="board" waitingLetterCount={waitingCount}>
    <GuidedFirstLetter userId={user.id}/>
  </AppShell>
}

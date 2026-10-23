import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GuidedWriting from './guided-writing'

export default async function GuidedOpenLetterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fboard%2Fwrite%2Fguide')
  return <GuidedWriting authorId={user.id} />
}

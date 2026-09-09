import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DispatchComposer from '../dispatch-composer'

export default async function WriteDispatchPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return <DispatchComposer authorId={user.id} />
}

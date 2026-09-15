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

  // Dispatch Postcards Checkpoint 2 — resolved here so DispatchComposer
  // can pass the author's CURRENT pseudonym into PostcardEditor's own
  // live draft preview (never a snapshot at draft time; publish_dispatch
  // itself snapshots the real value again, independently, at Publish).
  const { data: profile } = await supabase.from('profiles').select('pseudonym').eq('id', user.id).maybeSingle()

  return <DispatchComposer authorId={user.id} authorPseudonym={profile?.pseudonym ?? ''} />
}

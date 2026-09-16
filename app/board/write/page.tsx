import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasCompletedGuide } from '@/lib/guide'
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
  const [{ data: profile }, composerIntroSeen, postcardIntroSeen] = await Promise.all([
    supabase.from('profiles').select('pseudonym').eq('id', user.id).maybeSingle(),
    hasCompletedGuide(supabase, user.id, 'dispatch_composer'),
    hasCompletedGuide(supabase, user.id, 'postcard'),
  ])

  return (
    <DispatchComposer
      authorId={user.id}
      authorPseudonym={profile?.pseudonym ?? ''}
      showComposerIntro={!composerIntroSeen}
      showPostcardIntro={!postcardIntroSeen}
    />
  )
}

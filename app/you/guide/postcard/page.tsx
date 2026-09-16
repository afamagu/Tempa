import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayFeatureIntroduction from '../replay-feature-introduction'

export default async function ReplayPostcardGuide() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <ReplayFeatureIntroduction guideKey="postcard" title="Send something from somewhere" ctaLabel="Choose a Postcard">
      <p>
        Postcards are little keepsakes you can tuck into a Letter or Dispatch. Choose one, write
        something on the front, then leave something more on the back for the reader to discover.
      </p>
    </ReplayFeatureIntroduction>
  )
}

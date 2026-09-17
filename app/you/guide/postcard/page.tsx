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
    <ReplayFeatureIntroduction
      guideKey="postcard"
      title="Postcards"
      ctaLabel="Choose a postcard"
      destinationHref="/board/write"
    >
      <p className="italic">Send a little piece of a place.</p>
      <p>
        Choose a postcard, add a few words to the front, and write something more on the back —
        then send it along with your Letter or Dispatch as a small keepsake.
      </p>
    </ReplayFeatureIntroduction>
  )
}

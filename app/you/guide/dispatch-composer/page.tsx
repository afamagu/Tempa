import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayFeatureIntroduction from '../replay-feature-introduction'

export default async function ReplayDispatchComposerGuide() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <ReplayFeatureIntroduction
      guideKey="dispatch_composer"
      title="Leave something on the Board"
      ctaLabel="Start writing"
      destinationHref="/board/write"
    >
      <p>
        A Dispatch is public writing. It might be a story from your day, something you&rsquo;ve
        noticed, a question you&rsquo;ve been carrying, or simply something worth putting into
        words.
      </p>
      <p>It doesn&rsquo;t need to sound important. It just needs to sound like you.</p>
    </ReplayFeatureIntroduction>
  )
}

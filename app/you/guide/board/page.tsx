import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayFeatureIntroduction from '../replay-feature-introduction'

export default async function ReplayBoardGuide() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <ReplayFeatureIntroduction
      guideKey="board"
      title="The Board"
      ctaLabel="See what's on the Board"
      destinationHref="/board"
    >
      <p className="italic">Writing meant to be stumbled upon.</p>
      <p>
        Dispatches are public pieces Tempa members leave behind — stories, observations,
        questions, things they&rsquo;ve been thinking about.
      </p>
      <p>
        Read whatever catches you. If the person behind it interests you, you can visit their
        profile or write to them privately.
      </p>
    </ReplayFeatureIntroduction>
  )
}

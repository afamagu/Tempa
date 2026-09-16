import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayFeatureIntroduction from '../replay-feature-introduction'

export default async function ReplayPeopleGuide() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <ReplayFeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
      <p>
        Tempa isn&rsquo;t about collecting followers. Take your time. Open someone&rsquo;s
        profile, read a little of what they&rsquo;ve shared, and write when somebody genuinely
        catches your attention.
      </p>
    </ReplayFeatureIntroduction>
  )
}

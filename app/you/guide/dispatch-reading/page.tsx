import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReplayFeatureIntroduction from '../replay-feature-introduction'

// Post-onboarding corrections checkpoint (Q2) — the replay entry for the
// first-read Dispatch introduction, same lightweight pattern as the other
// four (people/board/dispatch-composer/postcard). "Start reading" sends
// the member to the Board, an appropriate reading-capable surface, rather
// than just closing back to the Guide index — there is no single "the"
// Dispatch to reopen from a replay with no reading context.
export default async function ReplayDispatchReadingGuide() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <ReplayFeatureIntroduction
      guideKey="dispatch_reading"
      title="Reading a Dispatch"
      ctaLabel="Start reading"
      destinationHref="/board"
    >
      <p>
        Take your time. A Dispatch may have little Moments tucked into the writing — glimpses
        from the writer&rsquo;s world that you can open as you go. At the end, you can mark it
        Worth Reading, reply publicly, or write privately if you&rsquo;d like to know the writer.
      </p>
    </ReplayFeatureIntroduction>
  )
}

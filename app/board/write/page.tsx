import { redirect } from 'next/navigation'
import { webChoiceAvailable } from '@/lib/public-dispatches'
import { createClient } from '@/lib/supabase/server'
import { hasCompletedGuide } from '@/lib/guide'
import DispatchComposer from '../dispatch-composer'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { getMyWritingStyle } from '@/lib/writing-style-data'

export default async function WriteDispatchPage({ searchParams }: { searchParams: Promise<{ firstArrival?: string }> }) {
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
  const [{ data: profile }, composerIntroSeen, postcardIntroSeen, writingStyleId, params] = await Promise.all([
    supabase.from('profiles').select('pseudonym, mark_id, first_arrival_journey_version, first_letter_invitation_done_at').eq('id', user.id).maybeSingle(),
    hasCompletedGuide(supabase, user.id, 'dispatch_composer'),
    hasCompletedGuide(supabase, user.id, 'postcard'),
    getMyWritingStyle(supabase, user.id),
    searchParams,
  ])

  return (
    <DispatchComposer
      afterFirstArrival={params.firstArrival === '1' && profile?.first_arrival_journey_version === 2 && !profile.first_letter_invitation_done_at}
      authorId={user.id}
      authorPseudonym={profile?.pseudonym ?? ''}
      authorMarkUrl={profile?.mark_id ? publicProfileMarkUrl(supabase, `${profile.mark_id}.png`) : null}
      showComposerIntro={!composerIntroSeen}
      showPostcardIntro={!postcardIntroSeen}
      webChoiceAvailable={await webChoiceAvailable(supabase)}
      writingStyleId={writingStyleId}
    />
  )
}

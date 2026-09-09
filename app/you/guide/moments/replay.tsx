'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markGuideCompleted } from '@/lib/guide'
import MomentsWalkthrough from '@/app/guide/moments-walkthrough'

// A replay never changes correspondence or photo-consent state — it
// only (harmlessly, idempotently) confirms the guide is marked
// complete, same as it already would be for anyone reaching this page.
export default function ReplayMomentsGuide() {
  const router = useRouter()

  async function finish() {
    const supabase = createClient()
    const { error } = await markGuideCompleted(supabase, 'moments')
    if (error) {
      console.error('[moments-guide] replay completion write failed', error)
    }
    router.push('/you/guide')
  }

  return (
    <MomentsWalkthrough
      allowSkip
      otherPseudonym={null}
      onExit={finish}
      finalLabel="Done"
      onFinish={finish}
    />
  )
}

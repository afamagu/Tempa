'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markGuideCompleted } from '@/lib/guide'
import MindsWalkthrough from '@/app/guide/minds-walkthrough'

// A replay never changes Minds/Question state — it only (harmlessly,
// idempotently) confirms the guide is marked complete, same as it
// already would be for anyone reaching this page.
export default function ReplayMindsGuide() {
  const router = useRouter()

  async function finish() {
    const supabase = createClient()
    const { error } = await markGuideCompleted(supabase, 'minds')
    if (error) {
      console.error('[minds-guide] replay completion write failed', error)
    }
    router.push('/you/guide')
  }

  return <MindsWalkthrough onExit={finish} onFinish={finish} />
}

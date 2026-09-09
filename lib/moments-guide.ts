import type { SupabaseClient } from '@supabase/supabase-js'
import { markGuideCompleted, type GuideWriteError } from '@/lib/guide'
import { acknowledgeCorrespondenceFeature, type AcknowledgementWriteError } from '@/lib/acknowledgements'

export type MomentsFinishOutcome =
  | { status: 'navigated'; guideError: GuideWriteError; ackError: AcknowledgementWriteError }
  | {
      status: 'navigation-failed'
      guideError: GuideWriteError
      ackError: AcknowledgementWriteError
      navigationError: unknown
    }

/**
 * The full "Continue writing" transaction for the mandatory, no-skip
 * Moments walkthrough — deliberately a plain async function, not
 * inlined in the client component, so it can be exercised directly in
 * tests without React/next/navigation.
 *
 * Sequencing is fixed: both writes are always attempted (in order,
 * awaited one after the other so a slow/failing guide-completion write
 * can never race the acknowledgement write against the same connection
 * pool in a confusing order), and navigation is always attempted
 * afterward regardless of whether either write succeeded. Neither write
 * failure may ever prevent navigation — the entire reason this function
 * exists is that a swallowed write failure previously left the member
 * stuck behind a tutorial with no Close/X. `navigate` is caller-supplied
 * so this function has no direct dependency on next/navigation's router
 * and stays trivially testable with a fake that can be made to throw.
 */
export async function completeMomentsWalkthrough(
  supabase: SupabaseClient,
  correspondenceId: string,
  navigate: () => void
): Promise<MomentsFinishOutcome> {
  const { error: guideError } = await markGuideCompleted(supabase, 'moments')
  const { error: ackError } = await acknowledgeCorrespondenceFeature(
    supabase,
    correspondenceId,
    'moments_available'
  )

  try {
    navigate()
    return { status: 'navigated', guideError, ackError }
  } catch (navigationError) {
    return { status: 'navigation-failed', guideError, ackError, navigationError }
  }
}

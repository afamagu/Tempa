import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { WRITING_STYLE_PATH } from '@/lib/onboarding'
import { getMyWritingStyle } from '@/lib/writing-style-data'
import { getWritingSample } from '@/lib/writing-style-sample'
import { WRITING_STYLE_HEADING, WRITING_STYLE_INTRO } from '@/lib/writing-style'
import WritingStyleChooser from '@/app/writing-style-chooser'

/** Pure: where the step continues to. Only a safe internal path that is
 * not this step itself; anything else lands on Home. */
export function resolveWritingStyleNext(next: string | undefined): string {
  const safe = sanitizeInternalPath(next)
  if (!safe) return '/home'
  const pathname = safe.split(/[?#]/, 1)[0]
  if (pathname === WRITING_STYLE_PATH || pathname.startsWith(`${WRITING_STYLE_PATH}/`)) return '/home'
  return safe
}

/**
 * Writing Style — onboarding step 4 (after the Flagship Question), and the
 * one-time choice for members who completed onboarding before Writing
 * Styles existed. Both are the same derived condition: onboarding
 * complete, no valid style yet. proxy.ts routes such a member here once
 * (carrying `next`); choosing a style is what ends it — never a local
 * "seen" flag, so refresh, back/forward and a new device all resume here
 * until the choice is saved, and never again afterwards.
 *
 * Guards repeat the central resolver as defense in depth: earlier steps
 * resume where they belong; a member who already has a style is sent on.
 */
export default async function WritingStyleStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = resolveWritingStyleNext(next)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/profile')
  if (profile.onboarding_stage === 'mark') redirect('/profile/mark')
  if (profile.onboarding_stage === 'question') redirect('/profile/question')

  const current = await getMyWritingStyle(supabase, user.id)
  if (current) redirect(destination)

  const sample = await getWritingSample(supabase, user.id)

  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-8 sm:py-14">
      <div className="w-full max-w-3xl">
        <WritingStyleChooser
          mode="onboarding"
          destination={destination}
          heading={WRITING_STYLE_HEADING}
          intro={WRITING_STYLE_INTRO}
          sample={sample.text}
          sampleIsOwn={sample.source !== 'fallback'}
        />
      </div>
    </main>
  )
}

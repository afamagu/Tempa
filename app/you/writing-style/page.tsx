import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyWritingStyle } from '@/lib/writing-style-data'
import { getWritingSample } from '@/lib/writing-style-sample'
import WritingStyleChooser from '@/app/writing-style-chooser'

/**
 * You → Writing style. The same six choices as onboarding, starting from
 * the member's current style. Changing it affects profile prose from now
 * on and letters/Dispatches written afterwards; anything already sent or
 * published keeps the style it went out in (send-time snapshots).
 */
export default async function YouWritingStylePage() {
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

  const [current, sample] = await Promise.all([getMyWritingStyle(supabase, user.id), getWritingSample(supabase, user.id)])

  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-8 sm:py-14">
      <div className="w-full max-w-3xl">
        <WritingStyleChooser
          mode="settings"
          heading="Your writing style"
          intro="How your words appear when they reach someone. Letters and Dispatches you’ve already sent keep the style they were sent in."
          initialStyleId={current}
          sample={sample.text}
          sampleIsOwn={sample.source !== 'fallback'}
        />
      </div>
    </main>
  )
}

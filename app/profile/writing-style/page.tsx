import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { WRITING_STYLE_PATH } from '@/lib/onboarding'
import { getMyWritingStyle } from '@/lib/writing-style-data'
import { getWritingSample } from '@/lib/writing-style-sample'
import WritingStyleChooser from '@/app/writing-style-chooser'

export function resolveWritingStyleNext(next: string | undefined): string {
  const safe = sanitizeInternalPath(next)
  if (!safe) return '/home'
  const pathname = safe.split(/[?#]/, 1)[0]
  if (pathname === WRITING_STYLE_PATH || pathname.startsWith(`${WRITING_STYLE_PATH}/`)) return '/home'
  return safe
}

export default async function WritingStyleStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = resolveWritingStyleNext(next)
  const t = await getTranslations('WritingStyle')
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
          heading={t('heading')}
          intro={t('intro')}
          sample={sample.text}
          sampleIsOwn={sample.source !== 'fallback'}
        />
      </div>
    </main>
  )
}

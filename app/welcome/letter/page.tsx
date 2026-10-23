import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { primaryButtonClass, quietLinkClass } from '@/app/profile/ui'

async function proceedToIntroductions() {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const { error } = await supabase.from('profiles')
    .update({ first_letter_invitation_done_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) throw new Error('Could not save your choice. Please try again.')
  redirect('/welcome/people')
}

/** The invitation is a durable step, but public writing is always optional. */
export default async function FirstOpenLetterInvitation() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const [{ data: profile, error }, { data: published }] = await Promise.all([
    supabase.from('profiles')
      .select('mark_id, first_arrival_seen_at, first_arrival_journey_version, first_letter_invitation_done_at, auto_match_completed_at')
      .eq('id', user.id).maybeSingle(),
    supabase.from('dispatches').select('id').eq('author_id', user.id)
      .eq('published_as', 'member').eq('status', 'published').limit(1),
  ])
  if (error) return <main className="mx-auto max-w-xl px-6 py-20">
    <h1 className="font-serif text-3xl">Your letters are waiting.</h1>
    <p className="mt-3 text-foreground/70">This step couldn&apos;t load. Please refresh to try again.</p>
    <Link href="/welcome/letter" className={`mt-7 inline-flex ${primaryButtonClass}`}>Try again →</Link>
  </main>
  if (!profile) redirect('/profile')
  if (!profile.mark_id) redirect('/you/mark')
  if (!profile.first_arrival_seen_at) redirect('/welcome')
  if (profile.first_arrival_journey_version !== 2) redirect('/welcome/people')
  if (profile.first_letter_invitation_done_at) redirect('/welcome/people')

  // A successful publication is sufficient to finish the writing step,
  // including when the browser refreshed during the publication handoff.
  if (published?.length) {
    const { error: updateError } = await supabase.from('profiles')
      .update({ first_letter_invitation_done_at: new Date().toISOString() })
      .eq('id', user.id)
    if (!updateError) redirect('/welcome/people')
  }

  const t = await getTranslations('FirstLetterArrival')
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-5xl flex-col justify-center px-5 py-14 sm:px-12 sm:py-20">
      <div className="max-w-2xl">
        <p className="font-serif text-xl italic text-foreground/75">Tempa<span className="text-[#a36a4d]">.</span></p>
        <p className="mt-12 text-[11px] font-semibold uppercase tracking-[.2em] text-[#94745f]">{t('eyebrow')}</p>
        <h1 className="mt-4 font-serif text-[clamp(2.5rem,7vw,4.6rem)] font-normal leading-[1.08] tracking-[-.035em]">{t('heading')}</h1>
        <p className="mt-6 max-w-xl font-serif text-[21px] leading-relaxed text-foreground/80">{t('lead')}</p>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-foreground/65">{t('body')}</p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href="/board/guided?firstArrival=1" className={primaryButtonClass}>{t('helpStart')} <span aria-hidden="true">→</span></Link>
          <Link href="/board/write?firstArrival=1" className={quietLinkClass}>{t('writeMyOwn')}</Link>
        </div>
        <form action={proceedToIntroductions} className="mt-9 border-t border-foreground/10 pt-5">
          <button type="submit" className={quietLinkClass}>{t('skipAndMeet')} →</button>
          <p className="mt-2 text-[12px] leading-relaxed text-foreground/55">{t('noPressure')}</p>
        </form>
      </div>
    </main>
  )
}

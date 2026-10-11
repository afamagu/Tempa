import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { primaryButtonClass, quietLinkClass } from '@/app/profile/ui'

async function enterTheBoard() {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const { error } = await supabase.rpc('complete_my_first_arrival')
  if (error) throw new Error('We could not finish your welcome. Please try again.')
  redirect('/board')
}

const destinations = [
  { title: 'The Board', body: 'Open letters left by members. Read, discover people, or pin a letter of your own.' },
  { title: 'Letterbox', body: 'The private letters you send, receive and exchange.' },
  { title: 'Home', body: 'What matters to you as you get to know people.' },
  { title: 'You', body: 'Your profile and preferences, whenever you want to make them your own.' },
] as const

/**
 * A real, durable first welcome. Completion happens server-side only when
 * the member deliberately enters. Refreshes and sign-ins can resume here.
 */
export default async function WelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const { data: profile } = await supabase.from('profiles')
    .select('id, first_arrival_seen_at').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/profile')
  if (profile.first_arrival_seen_at) redirect('/board')

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-5xl flex-col justify-center px-6 py-14 sm:px-12 sm:py-20">
      <div className="max-w-2xl">
        <p className="font-serif text-lg italic tracking-wide text-foreground/70">Tempa</p>
        <p className="mt-12 text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">A place to begin</p>
        <h1 className="mt-4 font-serif text-[43px] font-normal leading-[1.1] tracking-[-.025em] text-foreground sm:text-[60px]">
          Welcome to Tempa.
        </h1>
        <p className="mt-6 max-w-xl font-serif text-[21px] leading-relaxed text-foreground/80">
          People leave letters here about ordinary parts of their lives.
        </p>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-foreground/70">
          You can read, find someone worth knowing, and write when you feel like it. Nothing needs to be written before you look around.
        </p>
      </div>
      <section aria-label="Find your way around Tempa" className="mt-12 grid max-w-4xl gap-x-10 gap-y-7 border-t border-foreground/15 pt-8 sm:grid-cols-2">
        {destinations.map(item => <div key={item.title}>
          <h2 className="font-serif text-[22px] text-foreground">{item.title}</h2>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-foreground/65">{item.body}</p>
        </div>)}
      </section>
      <form action={enterTheBoard} className="mt-12">
        <button type="submit" className={`${primaryButtonClass} min-h-12 px-7`}>Enter The Board <span aria-hidden="true">→</span></button>
      </form>
      <p className="mt-5 text-[12px] leading-relaxed text-foreground/55">
        You can revisit this introduction from <Link href="/you/guide" className={quietLinkClass}>You → Tempa Guide</Link>.
      </p>
    </main>
  )
}

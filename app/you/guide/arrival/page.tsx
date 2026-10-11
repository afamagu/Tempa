import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { pageTitleClass, quietLinkClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import { getWaitingLetterCount } from '@/lib/letters'

const places = [
  ['The Board', 'Read open letters and find people. Pin a letter when you have something you would like to share.', '/board'],
  ['Letterbox', 'Private correspondence you have sent or received.', '/letters'],
  ['Home', 'The letters and people that matter to you, gathered in one place.', '/home'],
  ['You', 'Your profile, preferences and personal touches.', '/you'],
] as const

/** Repeatable orientation, independent of whether the first arrival was already completed. */
export default async function ArrivalGuide() {
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)redirect('/sign-in')
  const waiting=await getWaitingLetterCount(supabase,user.id)
  return <AppShell active="you" waitingLetterCount={waiting}>
    <main className="mx-auto max-w-2xl space-y-9 px-6 py-12">
      <Link href="/you/guide" className={quietLinkClass}>← Tempa Guide</Link>
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[.2em] text-[#94745f]">Find your way</p>
        <h1 className={pageTitleClass}>Welcome to Tempa.</h1>
        <p className="font-serif text-[19px] leading-relaxed text-foreground/75">A place for letters and people you might come to know through them.</p>
      </header>
      <div className="divide-y divide-foreground/10">
        {places.map(([name,description,href])=><div key={name} className="flex items-start justify-between gap-5 py-5">
          <div><h2 className="font-serif text-xl">{name}</h2><p className="mt-2 text-sm leading-relaxed text-foreground/65">{description}</p></div>
          <Link href={href} className={`${quietLinkClass} shrink-0`}>Visit →</Link>
        </div>)}
      </div>
      <p className="text-sm text-foreground/60">Nothing needs to be written before you look around.</p>
    </main>
  </AppShell>
}

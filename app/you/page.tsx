import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { sectionLabelClass, proseSubheadingClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'

export default async function YouPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('pseudonym')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    redirect('/profile')
  }

  const waitingCount = await getWaitingLetterCount(supabase, user.id)

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/sign-in')
  }

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 py-10">
          <div className="space-y-2">
            <p className={sectionLabelClass}>You</p>
            <h1 className={proseSubheadingClass}>{profile.pseudonym}</h1>
          </div>

          {/* The rich profile view (country, age band, languages,
              interests, published writing, "Write to this mind" when
              applicable) already exists at the canonical /minds/[userId]
              route, which already handles isSelf correctly — reusing it
              here rather than duplicating that content on this page. */}
          <Link
            href={`/minds/${user.id}`}
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
          >
            View your profile
          </Link>

          <Link
            href="/you/keepsakes"
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
          >
            Keepsakes
          </Link>

          <Link
            href="/you/interests"
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
          >
            Reading interests
          </Link>

          <Link
            href="/you/guide"
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
          >
            Tempa Guide
          </Link>

          <Link
            href="/you/safety/blocked-minds"
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
          >
            Blocked minds
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
            >
              Sign out
            </button>
          </form>
        </div>
      </main>
    </AppShell>
  )
}

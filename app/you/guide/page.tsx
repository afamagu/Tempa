import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { sectionTitleClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'

// Deliberately small — one guide exists today. Architected so future
// guides (First letters, Photos & trust, Postcards, Closing a
// correspondence, Safety) are additional rows here, not a redesign.
const GUIDES = [
  { key: 'minds', title: 'Welcome to Minds', href: '/you/guide/minds' },
  { key: 'moments', title: 'Writing with Moments', href: '/you/guide/moments' },
]

export default async function TempaGuidePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const waitingCount = await getWaitingLetterCount(supabase, user.id)

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-md space-y-8 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={sectionTitleClass}>Tempa Guide</h1>
            <p className={helperTextClass}>Revisit how a part of Tempa works, anytime.</p>
          </div>

          <div className="divide-y divide-foreground/10">
            {GUIDES.map((guide) => (
              <Link
                key={guide.key}
                href={guide.href}
                className="block py-4 text-[15px] text-foreground transition-colors first:pt-0 hover:text-accent"
              >
                {guide.title}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

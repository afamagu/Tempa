import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getPublishedDispatchesByAuthor } from '@/lib/dispatches'
import { sectionTitleClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import Mindform from '@/app/mindform'
import DispatchCard from '../../../board/dispatch-card'

function BackArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

/**
 * "See all Dispatches" — every published Dispatch by one writer,
 * newest first, no popularity ranking (the exact same
 * getPublishedDispatchesByAuthor pool the profile's own restrained
 * 3-preview section already draws from, just unrestricted here).
 * Reuses the Board's own DispatchCard row grammar rather than
 * inventing a second list presentation. Selecting one opens the normal
 * authenticated Dispatch reader — there is no separate "public" reader.
 */
export default async function AuthorDispatchesPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const supabase = await createClient()
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser()

  if (!viewer) {
    redirect('/sign-in')
  }

  const [{ data: profile }, waitingCount] = await Promise.all([
    supabase.from('public_profiles').select('id, pseudonym').eq('id', userId).maybeSingle(),
    getWaitingLetterCount(supabase, viewer.id),
  ])

  if (!profile) {
    notFound()
  }

  const dispatches = await getPublishedDispatchesByAuthor(supabase, userId)

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <Link
            href={`/minds/${userId}`}
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            <BackArrowIcon />
            {profile.pseudonym}
          </Link>

          <div className="flex items-center gap-3">
            <Mindform identifier={profile.id} size="md" />
            <h1 className={sectionTitleClass}>{profile.pseudonym}&rsquo;s Dispatches</h1>
          </div>

          {dispatches.length === 0 ? (
            <p className={helperTextClass}>No Dispatches yet.</p>
          ) : (
            <div className="space-y-4">
              {dispatches.map((dispatch) => (
                <DispatchCard key={dispatch.id} dispatch={dispatch} />
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

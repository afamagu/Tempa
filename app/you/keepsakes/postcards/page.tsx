import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyPostcards } from '@/lib/keepsakes'
import { getWaitingLetterCount } from '@/lib/letters'
import { sectionTitleClass, sectionLabelClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import KeepsakePostcardCard from './keepsake-postcard-card'
import KeepsakesEmptyState from './keepsakes-empty-state'
import TempaNote from '@/app/tempa-note'

/**
 * Admin Phase 2A-2 — You → Keepsakes → Postcards. Receiving a Postcard
 * automatically preserves it here once the parent letter has actually
 * delivered — there is no "Save Postcard" action anywhere. Derived
 * entirely from the existing letter_postcards/letters relationship
 * (lib/keepsakes.ts's getMyPostcards); no separate ownership table.
 *
 * Visual Language Pass 1B: the "how this works" line beneath the title
 * is a passive explanatory house note (no action), rendered through the
 * shared TempaNote primitive (app/tempa-note.tsx) — never applied to
 * KeepsakesEmptyState below, which is an ordinary empty state.
 */
export default async function KeepsakesPostcardsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, { data: postcards, error }] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyPostcards(supabase),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-5xl space-y-6 py-10">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className={sectionLabelClass}>Keepsakes</p>
              <h1 className={sectionTitleClass}>Your Postcards</h1>
            </div>
            <TempaNote>
              Postcards you receive are automatically kept here once they&apos;ve arrived — nothing to save, nothing to
              set up.
            </TempaNote>
          </div>

          {error && <p className="text-sm text-red-600">{error.message}</p>}

          {postcards.length === 0 ? (
            <KeepsakesEmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {postcards.map((postcard) => (
                <KeepsakePostcardCard key={postcard.letterId} postcard={postcard} />
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}

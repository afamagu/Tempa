import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyPostcards } from '@/lib/keepsakes'
import { getWaitingLetterCount } from '@/lib/letters'
import { sectionTitleClass, sectionLabelClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import KeepsakePostcardCard from './keepsake-postcard-card'
import KeepsakesEmptyState from './keepsakes-empty-state'

/**
 * Admin Phase 2A-2 — You → Keepsakes → Postcards. Receiving a Postcard
 * automatically preserves it here once the parent letter has actually
 * delivered — there is no "Save Postcard" action anywhere. Derived
 * entirely from the existing letter_postcards/letters relationship
 * (lib/keepsakes.ts's getMyPostcards); no separate ownership table.
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
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-1">
            <p className={sectionLabelClass}>Keepsakes</p>
            <h1 className={sectionTitleClass}>Your Postcards</h1>
            <p className={helperTextClass}>
              Postcards you receive are automatically kept here once they&apos;ve arrived — nothing to save,
              nothing to set up.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error.message}</p>}

          {postcards.length === 0 ? (
            <KeepsakesEmptyState />
          ) : (
            <div className="space-y-4">
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

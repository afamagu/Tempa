import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetterboxPeople,
  getWaitingLetterCount,
  getIncomingMailInTransit,
  incomingMailInTransitPersonIds,
} from '@/lib/letters'
import { getRelationshipCapacity, newCorrespondenceUnavailableMessage } from '@/lib/relationship-capacity'
import { pageTitleClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import LetterboxSearch from './letterbox-search'
import LettersTabs from './letters-tabs'
import { getTranslations } from 'next-intl/server'

/**
 * Letterbox Level 1 — a people-first address book, not a message
 * list. One card per person the viewer has at least one VISIBLE
 * correspondence episode with (see getLetterboxPeople in
 * lib/letters.ts for how multiple episodes with the same person
 * collapse into one entry, and how a hidden episode is excluded).
 * Tapping a card opens that person's letter archive
 * (/letters/with/[userId]), never an individual letter directly.
 *
 * LetterboxSearch owns the search field + mailbox-wide search
 * (search_letterbox) and falls back to rendering this same `people`
 * list, unchanged, whenever the query is empty — no separate grid
 * implementation, no other Letterbox redesign.
 */
export default async function LettersPage() {
  const t = await getTranslations('Letters')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [people, waitingCount, incomingInTransit, relationshipCapacity] = await Promise.all([
    getLetterboxPeople(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getRelationshipCapacity(supabase),
  ])
  const mailInTransitPersonIds = incomingMailInTransitPersonIds(incomingInTransit)
  const newCorrespondenceMessage = newCorrespondenceUnavailableMessage(relationshipCapacity)

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:px-8">
        {/* Release Polish Pass — widened from max-w-4xl so the restored
            3-column card grid has comfortable room at desktop widths
            (a "collections/people" surface, per this pass's own
            content-width guidance — wider than a reading measure). */}
        <div className="w-full max-w-5xl">
          <MemberNotices />
          <h1 className={pageTitleClass}>{t('heading')}</h1>
          <LettersTabs active="penPals" />
          {newCorrespondenceMessage && <div className="mb-6 rounded-md border border-foreground/10 bg-surface-shell px-4 py-3"><p className="text-xs uppercase tracking-widest text-foreground/55">Your correspondence</p><p className={`mt-1 ${helperTextClass}`}>{newCorrespondenceMessage} Your existing correspondences remain open.</p></div>}
          <LetterboxSearch people={people} mailInTransitPersonIds={mailInTransitPersonIds} />
        </div>
      </main>
    </AppShell>
  )
}

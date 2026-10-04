import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getWaitingLetterCount,
  getIncomingMailInTransit,
  incomingMailInTransitPersonIds,
} from '@/lib/letters'
import { getRelationshipSurfacePeople } from '@/lib/relationship-surface'
import {
  getRelationshipCapacity,
  correspondenceCapacitySummary,
} from '@/lib/relationship-capacity'
import { pageTitleClass, helperTextClass, sectionLabelClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import MemberNotices from '@/app/member-notices'
import LetterboxSearch from './letterbox-search'
import LettersTabs from './letters-tabs'
import { getTranslations } from 'next-intl/server'

/**
 * Phase 4 Letterbox — one relationship row per person, with first-contact
 * attempts and historical-only correspondence kept visibly distinct from
 * established living ties. Search still spans the member's existing people
 * and letters, but the default surface is relationship-first rather than an
 * inbox or an address-book gallery.
 */
export default async function LettersPage() {
  const t = await getTranslations('Letters')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const [people, waitingCount, incomingInTransit, relationshipCapacity] = await Promise.all([
    getRelationshipSurfacePeople(supabase, user.id),
    getWaitingLetterCount(supabase, user.id),
    getIncomingMailInTransit(supabase),
    getRelationshipCapacity(supabase),
  ])

  const mailInTransitPersonIds = incomingMailInTransitPersonIds(incomingInTransit)
  const capacitySummary = correspondenceCapacitySummary(relationshipCapacity)

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-5xl">
          <MemberNotices />
          <h1 className={pageTitleClass}>{t('heading')}</h1>
          <LettersTabs active="correspondence" />

          {capacitySummary && (
            <div className="mb-7 border-l-2 border-accent/35 pl-4">
              <p className={sectionLabelClass}>Your correspondence</p>
              <p className={`mt-1 ${helperTextClass}`}>{capacitySummary}</p>
            </div>
          )}

          <LetterboxSearch
            people={people}
            mailInTransitPersonIds={mailInTransitPersonIds}
          />
        </div>
      </main>
    </AppShell>
  )
}

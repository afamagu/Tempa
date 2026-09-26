import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { loadMarketplace } from '@/lib/marketplace'
import AppShell from '@/app/app-shell'
import CatalogueBrowser from '@/app/marketplace/catalogue-browser'

/**
 * Commerce Checkpoint 3 — You → Postcards (/you/postcards): the member marketplace. Read
 * server-side once per visit from member-readable data only (published
 * catalogue, own entitlements, own balance/switch context); the browser
 * never receives drafts, internal notes or anyone else's ownership.
 */
export default async function PostcardsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, marketplace] = await Promise.all([getWaitingLetterCount(supabase, user.id), loadMarketplace(supabase)])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-6 sm:px-6">
        <div className="w-full max-w-6xl py-6 sm:py-10">
          <CatalogueBrowser marketplace={marketplace} mode="browse" />
        </div>
      </main>
    </AppShell>
  )
}

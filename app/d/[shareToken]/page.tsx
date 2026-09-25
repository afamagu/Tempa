import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getSharedDispatch } from '@/lib/dispatches'
import { dispatchShareTitle } from '@/lib/dispatch-identity'
import SharedDispatchView from './shared-dispatch-view'
import DispatchUnavailable from './dispatch-unavailable'

// Memoized per request so generateMetadata and the page body share one
// get_shared_dispatch call rather than issuing it twice.
const loadSharedDispatch = cache(async (shareToken: string) => {
  const supabase = await createClient()
  return getSharedDispatch(supabase, shareToken)
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareToken: string }>
}): Promise<Metadata> {
  const { shareToken } = await params
  const dispatch = await loadSharedDispatch(shareToken)

  if (!dispatch) {
    return { title: 'Dispatch unavailable — Tempa' }
  }

  // Title + public identity only — never the body, never any private
  // profile data. Official: "{title} — Tempa" (never "by Tempa · Tempa");
  // Sponsored keeps its sponsor disclosure; member unchanged.
  const title = dispatchShareTitle(dispatch.title, dispatch.identity)
  return { title, openGraph: { title, siteName: 'Tempa', type: 'article' } }
}

/**
 * The external, unauthenticated Dispatch reader — /d/[shareToken].
 * Deliberately NOT wrapped in AppShell: a visitor arriving here has not
 * joined TEMPA, and the entire point of sharing is that the writing
 * itself, not an account wall, is what they see first. auth.getUser()
 * is checked only to steer the closing CTA (an authenticated visitor
 * who followed a forwarded link gets a route into the Board instead of
 * a Join prompt) — it never gates whether the Dispatch itself renders.
 *
 * All data comes from getSharedDispatch (get_shared_dispatch) — never a
 * direct query against dispatches/dispatch_topics/dispatch_moments/
 * public_profiles/kept_minds/dispatch_views. An invalid token, a
 * revoked one, and a token whose Dispatch is no longer published are
 * indistinguishable here by design, exactly matching that RPC's own
 * contract — all three render the same quiet DispatchUnavailable state.
 */
export default async function SharedDispatchPage({
  params,
}: {
  params: Promise<{ shareToken: string }>
}) {
  const { shareToken } = await params
  const dispatch = await loadSharedDispatch(shareToken)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!dispatch) {
    return <DispatchUnavailable />
  }

  return <SharedDispatchView dispatch={dispatch} isAuthenticated={Boolean(user)} />
}

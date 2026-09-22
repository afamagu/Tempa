'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Real sign-out for /begin's ineligible/review terminal states
 * (independent audit correction) — "Return to sign in" previously
 * linked to /sign-in without ending the authenticated session at all,
 * so proxy.ts/app/begin/page.tsx's own gate would just send the
 * member right back to this same terminal state on their next visit.
 * Same conventions as the existing sign-out action in
 * app/you/page.tsx (`createClient` from '@/lib/supabase/server',
 * `supabase.auth.signOut()`, then redirect) — kept in its own module,
 * rather than defined inline in page.tsx, specifically so it is
 * directly unit-testable (mocking '@/lib/supabase/server' and
 * 'next/navigation', the same pattern app/auth/callback/route.test.ts
 * already established) without needing to render the whole page.
 *
 * INSPECTS THE RETURNED ERROR (independent audit correction) — does
 * NOT rely on signOut() throwing. Supabase's signOut() resolves with
 * `{ error }` rather than throwing for an ordinary failure (e.g. a
 * transient network error talking to the auth server); a bare
 * try/catch around it would silently miss that returned error
 * entirely. A returned error is logged server-side only (message +
 * name, the same restrained shape app/auth/callback/route.ts's own
 * `[auth/callback] code exchange failed` log already uses) — never
 * surfaced to the member, who is redirected to /sign-in either way.
 * Does not change sign-out scope (still the same no-options call
 * app/you/page.tsx's own precedent uses — Supabase's default 'global'
 * scope is unchanged here, not something this pass introduces or
 * alters).
 */
export async function signOutAndReturnToSignIn() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    console.error('[begin] sign-out failed', { message: error.message, name: error.name })
  }

  redirect('/sign-in')
}

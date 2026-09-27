'use server'

import { createClient } from '@/lib/supabase/server'
import { resolvePostAuthDestination } from '@/lib/post-auth-destination'
import { sanitizeInternalPath } from '@/lib/safe-redirect'

/**
 * Google Identity Services sign-in (lib/google-identity.ts) establishes
 * the session in the browser, so there is no /auth/callback request to
 * decide where the member lands. This is that decision, server-side, from
 * the session cookie the browser just received — the exact same
 * lib/post-auth-destination.ts routing /auth/callback and the magic-link
 * action use (eligibility, legal acceptance, onboarding, then `next`).
 *
 * A Server Action is directly invocable, so `next` is re-sanitized here
 * and the user comes only from the verified session, never an argument.
 */
export async function googleSignInDestination(next: unknown): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return '/sign-in?error=auth_failed'

  const requested = sanitizeInternalPath(typeof next === 'string' ? next : null) ?? '/home'
  return resolvePostAuthDestination(supabase, user.id, requested)
}

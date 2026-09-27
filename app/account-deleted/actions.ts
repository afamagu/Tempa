'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * "Create a new account" after a voluntary deletion. Clears any leftover
 * session on this device first (a closed account's session would
 * otherwise route straight back to /account-deleted), then opens the
 * normal join flow. Nothing about the old account is carried over: the
 * new sign-up creates a brand-new Auth user and starts onboarding.
 * `scope: 'local'` — the old account's server-side sessions were
 * already removed when it was deleted.
 */
export async function startNewAccount() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    console.error('[account-deleted] local sign-out failed', { message: error.message, name: error.name })
  }
  redirect('/sign-in?intent=join')
}

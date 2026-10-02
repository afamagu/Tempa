'use server'

import { createClient } from '@/lib/supabase/server'

export async function continueWithoutIntroduction(): Promise<{ ok: boolean }> {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ok: false }
  const { error } = await client.rpc('defer_flagship_onboarding')
  return { ok: !error }
}

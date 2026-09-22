import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Privileged, service-role Supabase client. Bypasses RLS — only ever
 * import this from server-only code (the arrival-email worker, the
 * cron route that drives it), never from a Server/Client Component
 * that renders on a user's behalf. See lib/supabase/server.ts for the
 * ordinary per-request client that carries the signed-in user's own
 * session and respects RLS.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for the service-role client.')
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

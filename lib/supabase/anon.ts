import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * A stateless, anonymous Supabase client for open-web reads (public
 * Dispatch pages, sitemap). It never reads or writes session cookies, so
 * an anonymous article read does no authentication work and — whoever is
 * viewing — sees exactly what an anonymous crawler sees: only what the
 * SECURITY DEFINER open-web functions allow for the `anon` role.
 */
export function createAnonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AutoMatchArrival from './auto-match-arrival'

/**
 * Entered only from the durable, completed /welcome action. The Mark,
 * eligibility and legal gates remain upstream in the existing auth proxy.
 * Existing members never enter here as part of an ordinary sign-in.
 */
export default async function FirstArrivalPeoplePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('mark_id, first_arrival_seen_at, auto_match_completed_at, intent')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    // A database/schema read failure must not trap a new member in onboarding.
    return <main className="mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-3xl">Your letters are waiting.</h1>
      <p className="mt-4 text-foreground/70">Introductions are unavailable for now, but you can still explore The Board.</p>
      <a className="mt-8 inline-flex min-h-12 items-center rounded-md bg-accent px-6 text-accent-foreground" href="/board">Explore The Board →</a>
    </main>
  }
  if (!profile) redirect('/profile')
  if (!profile.mark_id) redirect('/you/mark')
  if (!profile.first_arrival_seen_at) redirect('/welcome')
  if (profile.auto_match_completed_at) redirect('/board')

  return <AutoMatchArrival userId={user.id} initialIntent={profile.intent ?? []} />
}

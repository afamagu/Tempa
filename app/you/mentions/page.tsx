import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import PublicMentions from '@/app/home/public-mentions'
import AppShell from '@/app/app-shell'
import { getWaitingLetterCount } from '@/lib/letters'
export default async function MentionsPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fyou%2Fmentions')
  const query = await searchParams
  const parsed = Number(query.offset ?? 0)
  const offset = Number.isSafeInteger(parsed) ? Math.min(100000, Math.max(0, parsed)) : 0
  const t = await getTranslations('Mentions')
  const waitingCount = await getWaitingLetterCount(client, user.id)
  return <AppShell active="you" waitingLetterCount={waitingCount}><main className="mx-auto w-full max-w-2xl space-y-5 px-6 py-10"><Link href="/home">{t('home')}</Link><PublicMentions history offset={offset}/></main></AppShell>
}

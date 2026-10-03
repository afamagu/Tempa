import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

export default async function MentionDestination({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('Mentions')
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/mentions/${id}`)}`)
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await client.rpc('open_public_mention', { p_id: id })
    if (!error && typeof data === 'string' && /^\/(board|room)\//.test(data)) redirect(data)
  }
  return <main className="mx-auto max-w-md space-y-5 p-6"><p>{t('unavailable')}</p><Link href="/home">{t('home')}</Link></main>
}

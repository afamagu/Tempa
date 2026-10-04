import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import HomeFamiliarFaces from './familiar-faces-home'

export default async function RoomInvitations() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.rpc('get_room_invitations')
  const invitations = !error && Array.isArray(data)
    ? data as { id: string; pseudonym: string; question_id: string; prompt: string }[]
    : []
  const t = invitations.length ? await getTranslations('RoomInvitations') : null

  return <>
    {invitations.length > 0 && t && <section aria-label={t('heading')} className="space-y-3 rounded-lg border border-accent/20 bg-surface-shell p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/55">{t('heading')}</p>
      {invitations.map((invitation) => <div key={invitation.id} className="space-y-2 border-b border-foreground/10 pb-3 last:border-0 last:pb-0">
        <p className="text-sm font-medium">{t('invited', { name: invitation.pseudonym })}</p><p className="font-serif text-lg">{invitation.prompt}</p>
        <Link href={`/question/${invitation.question_id}?source=room`} className="inline-block text-sm font-semibold text-accent underline underline-offset-4">{t('answer')}</Link>
      </div>)}
    </section>}
    <HomeFamiliarFaces />
  </>
}

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

type Mention = { id: string; kind: 'dispatch' | 'reply' | 'answer'; pseudonym: string; read_at: string | null }
export default async function PublicMentions({ history = false, offset = 0 }: { history?: boolean; offset?: number }) {
  const client = await createClient()
  const { data, error } = await client.rpc('get_public_mentions', { p_offset: offset, p_unread_only: !history })
  const t = await getTranslations('Mentions')
  if (error) return history ? <p role="status">{t('unavailable')}</p> : null
  const rows = (data ?? []) as Mention[]
  const visible = history ? rows.slice(0, 20) : rows.slice(0, 20).filter(row => !row.read_at).slice(0, 3)
  if (!rows.length && !history) return null
  return <section className="space-y-3 rounded-lg border border-accent/20 p-4" aria-label={t('heading')}>
    <h2 className="font-serif text-xl">{t('heading')}</h2>
    {visible.map(row => <Link prefetch={false} key={row.id} href={`/mentions/${row.id}`} className="block rounded-md py-2 text-sm underline underline-offset-4">
      {t(row.kind, { name: row.pseudonym })}
    </Link>)}
    {history && !rows.length && <p className="text-sm text-foreground/65">{t('empty')}</p>}
    {!history && <Link href="/you/mentions" className="inline-block py-2 text-sm font-medium">{t('all')}</Link>}
    {history && offset > 0 && <Link className="mr-4 inline-block py-2" href={`/you/mentions?offset=${Math.max(0, offset - 20)}`}>{t('previous')}</Link>}
    {history && rows.length > 20 && <Link className="inline-block py-2" href={`/you/mentions?offset=${offset + 20}`}>{t('more')}</Link>}
  </section>
}

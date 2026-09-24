import { createClient } from '@/lib/supabase/server'
import { getMyAccountStatus } from '@/lib/account-status'
import FromTempaNotice, { type FromTempaNoticeData } from '@/app/from-tempa-notice'

type NoticeRow = { id: string; kind: string; title: string; body: string }

/**
 * Official "From Tempa" notices for the signed-in member — the unread
 * ones, plus (for as long as the account is restricted) the restriction
 * notice itself, which stays put until the restriction is lifted. Read
 * through the member's own session and RLS (member_notices_select_own);
 * nothing here can see another member's notices. Renders nothing when
 * there is nothing to say.
 */
export default async function MemberNotices() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const status = await getMyAccountStatus(supabase)

  const { data: unread } = await supabase
    .from('member_notices')
    .select('id, kind, title, body')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(3)

  const notices: FromTempaNoticeData[] = ((unread ?? []) as NoticeRow[]).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    persistent: n.kind === 'restriction_applied' && status === 'restricted',
  }))

  if (status === 'restricted' && !notices.some((n) => n.persistent)) {
    const { data: latest } = await supabase
      .from('member_notices')
      .select('id, kind, title, body')
      .eq('kind', 'restriction_applied')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest) {
      const row = latest as NoticeRow
      notices.unshift({ id: row.id, title: row.title, body: row.body, persistent: true })
    }
  }

  if (notices.length === 0) return null

  return (
    <div className="mb-6 space-y-3">
      {notices.map((notice) => (
        <FromTempaNotice key={notice.id} notice={notice} />
      ))}
    </div>
  )
}

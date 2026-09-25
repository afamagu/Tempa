import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/admin'
import {
  canEditDispatch,
  getDispatchById,
  getDispatchMomentsForEditing,
  getDispatchPostcard,
  isWithinDispatchEditWindow,
  type OfficialPublishedAs,
} from '@/lib/dispatches'
import { getDispatchReplies } from '@/lib/replies'
import DispatchComposer from '@/app/board/dispatch-composer'

const LIST_HREF: Record<OfficialPublishedAs, string> = {
  tempa: '/admin/content/dispatches',
  sponsored: '/admin/content/sponsored',
}

/**
 * New / Edit for Tempa and Sponsored Dispatches — the SAME DispatchComposer
 * members use (title, rich body, topics, Moments, Preview → Publish,
 * optional Postcard), in its `publication` mode. The admin role check
 * here only avoids showing a composer that would be refused; the real
 * authority is publish_official_dispatch / update_official_dispatch,
 * which re-check is_staff('admin') themselves.
 */
export default async function OfficialComposerPage({
  kind,
  dispatchId,
}: {
  kind: OfficialPublishedAs
  dispatchId?: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  if (!(await isStaff(supabase, 'admin'))) redirect('/admin')

  if (!dispatchId) {
    return <DispatchComposer authorId={user.id} publication={{ publishedAs: kind }} />
  }

  const dispatch = await getDispatchById(supabase, dispatchId)
  if (!dispatch || dispatch.publishedAs !== kind) notFound()

  const replies = await getDispatchReplies(supabase, dispatch.id)
  const editable = canEditDispatch({
    isAuthor: dispatch.authorId === user.id,
    withinEditWindow: isWithinDispatchEditWindow(dispatch.publishedAt),
    replyExists: replies.length > 0,
  })
  if (!editable) redirect(LIST_HREF[kind])

  const [moments, postcard] = await Promise.all([
    getDispatchMomentsForEditing(supabase, dispatch.id),
    getDispatchPostcard(supabase, dispatch.id),
  ])
  const sponsor =
    dispatch.identity.kind === 'sponsored'
      ? {
          sponsorName: dispatch.identity.sponsor.name,
          ctaLabel: dispatch.identity.sponsor.ctaUrl ? dispatch.identity.sponsor.ctaLabel ?? '' : '',
          ctaUrl: dispatch.identity.sponsor.ctaUrl ?? '',
        }
      : null

  return (
    <DispatchComposer
      authorId={user.id}
      mode="edit"
      publication={{ publishedAs: kind, initialSponsor: sponsor }}
      existingDispatch={{
        id: dispatch.id,
        title: dispatch.title,
        body: dispatch.body,
        topics: dispatch.topics,
        moments,
        postcard,
      }}
    />
  )
}

import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getDispatchById,
  getDispatchMomentsForEditing,
  getDispatchPostcard,
  isWithinDispatchEditWindow,
  canEditDispatch,
} from '@/lib/dispatches'
import { getDispatchReplies } from '@/lib/replies'
import DispatchComposer from '../../dispatch-composer'

/**
 * /board/[dispatchId]/edit — author-only. Preserves the same Dispatch
 * id: this reuses DispatchComposer in `mode="edit"` (see that
 * component's own doc comment), which calls update_dispatch rather than
 * publish_dispatch, so internal Board/profile links and any external
 * share token all continue to point at the same Dispatch afterward.
 * A non-author (or a signed-out visitor) is redirected away exactly
 * like the reader itself does for a missing/unpublished Dispatch —
 * never a distinguishable "not yours" error that would reveal the
 * Dispatch's existence to someone who shouldn't be editing it.
 *
 * Smoke-test contract completion checkpoint (Section G) — a direct/
 * bookmarked visit after the 30-minute window closes or a Reply has
 * landed is redirected away the same way, rather than opening a
 * composer whose Save is guaranteed to fail. This is a courtesy
 * (avoids loading a dead-end screen), never the enforcement boundary —
 * update_dispatch itself is what actually refuses the write, so this
 * redirect being based on a possibly-stale read (see canEditDispatch's
 * own doc comment) can never create an unsafe edit, only, at worst, let
 * an already-ineligible author briefly see the composer before Save
 * rejects it (the same safely-handled case Section G explicitly
 * anticipates).
 */
export default async function EditDispatchPage({
  params,
}: {
  params: Promise<{ dispatchId: string }>
}) {
  const { dispatchId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const dispatch = await getDispatchById(supabase, dispatchId)
  if (!dispatch) {
    notFound()
  }

  if (dispatch.authorId !== user.id) {
    redirect(`/board/${dispatch.id}`)
  }

  // Official/Sponsored Dispatches are edited only through Admin Content
  // (staff-only update_official_dispatch) — never the member edit path.
  if (dispatch.publishedAs === 'tempa') redirect(`/admin/content/dispatches/${dispatch.id}/edit`)
  if (dispatch.publishedAs === 'sponsored') redirect(`/admin/content/sponsored/${dispatch.id}/edit`)

  const replies = await getDispatchReplies(supabase, dispatch.id)
  const editable = canEditDispatch({
    isAuthor: true,
    withinEditWindow: isWithinDispatchEditWindow(dispatch.publishedAt),
    replyExists: replies.length > 0,
  })

  if (!editable) {
    redirect(`/board/${dispatch.id}`)
  }

  const [moments, postcard, profile] = await Promise.all([
    getDispatchMomentsForEditing(supabase, dispatch.id),
    // Dispatch Postcards Checkpoint 2 — the already-published, immutable
    // Postcard this Dispatch carries, if any; shown read-only, never
    // editable through this composer.
    getDispatchPostcard(supabase, dispatch.id),
    supabase.from('profiles').select('pseudonym').eq('id', user.id).maybeSingle(),
  ])

  return (
    <DispatchComposer
      authorId={user.id}
      authorPseudonym={profile.data?.pseudonym ?? ''}
      mode="edit"
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

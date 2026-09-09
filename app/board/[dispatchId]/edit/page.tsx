import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDispatchById, getDispatchMomentsForEditing } from '@/lib/dispatches'
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

  const moments = await getDispatchMomentsForEditing(supabase, dispatch.id)

  return (
    <DispatchComposer
      authorId={user.id}
      mode="edit"
      existingDispatch={{
        id: dispatch.id,
        title: dispatch.title,
        body: dispatch.body,
        topics: dispatch.topics,
        moments,
      }}
    />
  )
}

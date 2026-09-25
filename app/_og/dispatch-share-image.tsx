import { createClient } from '@/lib/supabase/server'
import { getSharedDispatchPreview } from '@/lib/dispatches'
import { dispatchShareContextLine } from '@/lib/dispatch-identity'
import { SITE_DESCRIPTION } from '@/lib/site'
import { renderShareCard } from './share-card'

/**
 * /d/[shareToken] share image. Title + publication identity only, via
 * getSharedDispatchPreview (the same get_shared_dispatch share-token
 * gate) — never the body, never author_id, never the creating admin of
 * a Tempa/Sponsored Dispatch. A revoked/unknown token gets the neutral
 * Tempa card, indistinguishable from any other unavailable link.
 */
export async function renderDispatchShareImage(shareToken: string) {
  const supabase = await createClient()
  const preview = await getSharedDispatchPreview(supabase, shareToken)
  if (!preview) return renderShareCard({ title: SITE_DESCRIPTION, contextLine: 'Tempa' })
  if (preview.identity.kind === 'sponsored') {
    return renderShareCard({ title: preview.title, contextLine: preview.identity.name, sponsored: true })
  }
  return renderShareCard({ title: preview.title, contextLine: dispatchShareContextLine(preview.identity) })
}

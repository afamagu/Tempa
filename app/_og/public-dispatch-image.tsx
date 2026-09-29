import { createAnonClient } from '@/lib/supabase/anon'
import { getPublicDispatch } from '@/lib/public-dispatches'
import { dispatchShareContextLine } from '@/lib/dispatch-identity'
import { SITE_DESCRIPTION } from '@/lib/site'
import { renderShareCard } from './share-card'

/**
 * /dispatches/[slug] share image: the Dispatch title + public identity on
 * the Tempa card. Read through get_public_dispatch (anonymous), so a
 * Dispatch that is not public on the web right now — members-only,
 * hidden, unpublished, deleted — gets the neutral Tempa card and never
 * its old title. Never uses a Dispatch photo: members' photos are only
 * reachable through short-lived signed URLs, and the card must be a
 * stable, permanent image URL.
 */
export async function renderPublicDispatchImage(slug: string) {
  const d = await getPublicDispatch(createAnonClient(), slug)
  if (!d) return renderShareCard({ title: SITE_DESCRIPTION, contextLine: 'Tempa' })
  if (d.identity.kind === 'sponsored') {
    return renderShareCard({ title: d.title, contextLine: d.identity.name, sponsored: true })
  }
  return renderShareCard({
    title: d.title,
    contextLine: d.identity.kind === 'member' ? `A Dispatch by ${d.identity.name}` : dispatchShareContextLine(d.identity),
  })
}

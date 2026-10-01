import { redirect } from 'next/navigation'

/**
 * Compatibility route for links/bookmarks created before a member's
 * Dispatches and Question responses were gathered under You → Your
 * archive. Keep the old URL working, but give the archive one canonical
 * home so the two management surfaces never drift apart again.
 */
export default async function YourResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  redirect(tab === 'new' ? '/you/archive?tab=responses&mode=new' : '/you/archive?tab=responses')
}

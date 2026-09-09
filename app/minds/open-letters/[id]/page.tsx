import { redirect } from 'next/navigation'

// See app/minds/open-letters/page.tsx's own comment. The old param name
// (id) is simply forwarded as the new route's dispatchId.
export default async function LegacyOpenLetterRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/board/${id}`)
}

import DispatchPage from '@/app/board/[dispatchId]/page'

/** Canonical member reading URL; shares exactly the established secured reader. */
export default async function RoomLetterPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  return DispatchPage({ params: Promise.resolve({ dispatchId: id }), searchParams })
}

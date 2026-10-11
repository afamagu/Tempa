import DispatchPage from '@/app/board/[dispatchId]/page'

/** Keep the established secured reader and its source-attributed contact flow. */
export default async function BoardLetterPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  return DispatchPage({ params: Promise.resolve({ dispatchId: id }), searchParams })
}

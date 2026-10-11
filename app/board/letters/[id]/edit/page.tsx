import EditDispatchPage from '@/app/board/[dispatchId]/edit/page'

export default async function EditBoardLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return EditDispatchPage({ params: Promise.resolve({ dispatchId: id }) })
}

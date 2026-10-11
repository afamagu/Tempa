import EditDispatchPage from '@/app/board/[dispatchId]/edit/page'

export default async function EditRoomLetterPage({ params }: {params: Promise<{id: string}>}) {
  const { id } = await params
  return EditDispatchPage({ params: Promise.resolve({ dispatchId: id }) })
}

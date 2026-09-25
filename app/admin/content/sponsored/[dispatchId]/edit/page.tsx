import OfficialComposerPage from '../../../official-dispatches/official-composer-page'

export default async function EditSponsoredDispatchPage({ params }: { params: Promise<{ dispatchId: string }> }) {
  const { dispatchId } = await params
  return <OfficialComposerPage kind="sponsored" dispatchId={dispatchId} />
}

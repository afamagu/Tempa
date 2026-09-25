import OfficialComposerPage from '../../../official-dispatches/official-composer-page'

export default async function EditTempaDispatchPage({ params }: { params: Promise<{ dispatchId: string }> }) {
  const { dispatchId } = await params
  return <OfficialComposerPage kind="tempa" dispatchId={dispatchId} />
}

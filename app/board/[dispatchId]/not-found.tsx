import UnavailableState from '@/app/unavailable-state'

export default function DispatchNotFound() {
  return (
    <UnavailableState
      title="This Dispatch is no longer available."
      description="It may have been removed or is no longer available to view."
      actionHref="/board"
      actionLabel="Back to The Board"
    />
  )
}

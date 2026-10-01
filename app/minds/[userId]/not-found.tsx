import UnavailableState from '@/app/unavailable-state'

export default function ProfileNotFound() {
  return (
    <UnavailableState
      title="This profile is no longer available."
      description="This profile can no longer be viewed on Tempa."
      actionHref="/room"
      actionLabel="Back to The Room"
    />
  )
}

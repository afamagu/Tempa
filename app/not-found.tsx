import UnavailableState from '@/app/unavailable-state'

export default function NotFound() {
  return (
    <UnavailableState
      title="Nothing here."
      description="Whatever was at this address is no longer available, or the address may be incorrect."
      actionHref="/"
      actionLabel="Return to Tempa"
    />
  )
}

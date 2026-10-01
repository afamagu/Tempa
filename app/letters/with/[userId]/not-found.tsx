import UnavailableState from '@/app/unavailable-state'

export default function CorrespondenceNotFound() {
  return (
    <UnavailableState
      title="This correspondence is no longer available."
      description="There is no correspondence available to open here."
      actionHref="/letters"
      actionLabel="Back to Letterbox"
    />
  )
}

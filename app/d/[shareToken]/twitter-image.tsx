import { renderDispatchShareImage } from '@/app/_og/dispatch-share-image'

export const alt = 'A Dispatch on Tempa'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params
  return renderDispatchShareImage(shareToken)
}

import { renderPublicDispatchImage } from '@/app/_og/public-dispatch-image'

export const alt = 'A Dispatch on Tempa'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// Re-checked on every request: a Dispatch that stops being public on the
// web immediately stops producing its titled card.
export const dynamic = 'force-dynamic'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return renderPublicDispatchImage(slug)
}

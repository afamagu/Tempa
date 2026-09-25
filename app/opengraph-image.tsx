import { renderShareCard } from '@/app/_og/share-card'
import { SITE_DESCRIPTION } from '@/lib/site'

export const alt = 'Tempa — meet people through what they think, write and choose to share.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return renderShareCard({
    title: SITE_DESCRIPTION,
    contextLine: 'A pen-pal experience built around thoughtful letters',
  })
}

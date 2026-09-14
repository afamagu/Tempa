import Link from 'next/link'
import QuillIcon from '@/app/quill-icon'
import { primaryButtonClass } from '@/app/profile/ui'

/**
 * Release Polish Pass — The Board's own writing CTA, now composed with
 * the same quill mark used elsewhere (app/quill-icon.tsx, previously
 * only on the archive's own floating write action) rather than a bare
 * text button — one recognizable cross-product writing affordance
 * instead of each surface inventing its own. The text label stays
 * always visible (never icon-only) so it remains accessibly named
 * without depending on aria-label alone.
 */
export default function WriteDispatchButton() {
  return (
    <Link href="/board/write" className={`gap-2 ${primaryButtonClass}`}>
      <QuillIcon className="h-4 w-4" />
      Write a Dispatch
    </Link>
  )
}

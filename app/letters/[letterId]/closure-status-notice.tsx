import EnvelopeIcon from '@/app/envelope-icon'
import { closureTextClass } from '@/app/profile/ui'

/**
 * Release Polish Pass — the closed-letter status notice ("This letter
 * went unanswered" / "{pseudonym} passed on this letter"), restyled as
 * quiet correspondence METADATA rather than another content card that
 * visually blends into the historical letter and the recommendations
 * beneath it. A narrow left accent rule in the one restrained secondary
 * accent (clay) plus a small static envelope glyph — deliberately NOT
 * a bordered/filled card (which would double up against the outer
 * PhotoConsent wrapper this can share a container with) and never a
 * bright warning color: a closure is a settled state, not an error or
 * a punishment.
 */
export default function ClosureStatusNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex gap-2.5 border-l-2 border-clay/50 pl-3">
      <EnvelopeIcon className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
      <div className="space-y-1">
        <p className={closureTextClass}>{title}</p>
        <p className={closureTextClass}>{detail}</p>
      </div>
    </div>
  )
}

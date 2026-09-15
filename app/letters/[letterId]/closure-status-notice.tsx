import TempaNote from '@/app/tempa-note'

/**
 * Release Polish Pass — the closed-letter status notice ("This letter
 * went unanswered" / "{pseudonym} passed on this letter"), restyled as
 * quiet correspondence METADATA rather than another content card that
 * visually blends into the historical letter and the recommendations
 * beneath it. A closure is a settled state, not an error or a
 * punishment, so it never uses a bright warning color.
 *
 * Dispatch Culture Polish Pass: this was the ORIGINAL clay-left-rule
 * treatment that the shared TempaNote primitive (app/tempa-note.tsx)
 * generalizes from — now rendered through TempaNote itself rather than
 * its own bespoke markup. The static envelope glyph this used to carry
 * is removed: TempaNote's own "Tempa Note" label is now the one unified
 * identity marker, and a second icon here would compete with it rather
 * than reinforce it.
 */
export default function ClosureStatusNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <TempaNote>
      <p>{title}</p>
      <p>{detail}</p>
    </TempaNote>
  )
}

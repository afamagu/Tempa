import { systemBodyClass } from '@/app/profile/ui'
import { SAFETY_NOTE_TITLE, RECIPIENT_CONTACT_NOTE_BODY } from '@/lib/safety/send-with-safety'

/**
 * A short, non-accusatory privacy reminder attached to a DELIVERED letter
 * whose sender shared personal contact details or invited the recipient
 * to another app. Shown only to the recipient (the row behind it is
 * protected by letter_safety_notices' recipient-only RLS) and only ever
 * about sharing — it says nothing about the sender's intent, never
 * mentions Safety signals, and is not a strike: sharing contact details
 * is allowed, this simply reminds the reader they never have to.
 */
export default function ContactSharingNote({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-label="A note from Tempa about sharing personal details"
      className={`space-y-2 border-l-2 border-clay/50 pl-3 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">{SAFETY_NOTE_TITLE}</p>
      {RECIPIENT_CONTACT_NOTE_BODY.map((paragraph) => (
        <p key={paragraph} className={systemBodyClass}>
          {paragraph}
        </p>
      ))}
    </aside>
  )
}

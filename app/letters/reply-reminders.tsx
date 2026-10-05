import Link from 'next/link'
import type { ReplyReminder } from '@/lib/reply-reminders'
import { helperTextClass, quietLinkClass, sectionLabelClass } from '@/app/profile/ui'

export default function ReplyReminders({ reminders }: { reminders: ReplyReminder[] }) {
  if (reminders.length === 0) return null

  return (
    <section className="mb-7 space-y-3" aria-labelledby="reply-reminders-heading">
      <p id="reply-reminders-heading" className={sectionLabelClass}>A quiet reminder</p>
      <div className="space-y-2">
        {reminders.map((reminder) => (
          <div
            key={reminder.reminderId}
            className="rounded-md border border-foreground/10 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-5"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] text-foreground">
                {reminder.counterpartPseudonym}&apos;s letter is still waiting for you.
              </p>
              <p className={helperTextClass}>
                This letter has moved beyond your writing rhythm. There is no deadline here.
              </p>
            </div>
            <Link
              href={`/letters/${reminder.sourceLetterId}`}
              className={`mt-2 inline-block shrink-0 sm:mt-0 ${quietLinkClass}`}
            >
              Return to the letter
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

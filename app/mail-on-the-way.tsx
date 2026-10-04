import Image from 'next/image'

/**
 * Presentation-only postal notice for incoming mail that exists but has not
 * yet reached this viewer. Every caller still decides visibility from the
 * canonical incoming_mail_in_transit data; this component never reveals the
 * sender, content, or timing of a letter that has not arrived.
 */
export default function MailOnTheWay({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-clay/15 bg-clay/[.08] px-2.5 py-2 ${className}`}
    >
      <Image
        src="/brand/mail-on-the-way.png"
        alt=""
        aria-hidden="true"
        width={72}
        height={24}
        className="h-5 w-auto shrink-0"
      />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight text-clay">A letter is on the way</p>
        <p className="text-[11.5px] leading-tight text-foreground/55">It hasn&apos;t arrived yet.</p>
      </div>
    </div>
  )
}

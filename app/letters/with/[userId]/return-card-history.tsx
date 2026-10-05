import Link from 'next/link'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import { formatDateTimeCompact } from '@/lib/format-date'
import { returnCardVersionToBaseContent, type ReturnCard } from '@/lib/return-cards'
import { helperTextClass, sectionLabelClass } from '@/app/profile/ui'

export default function ReturnCardHistory({
  cards,
  viewerId,
  otherPseudonym,
}: {
  cards: ReturnCard[]
  viewerId: string
  otherPseudonym: string
}) {
  if (cards.length === 0) return null

  return (
    <section aria-label={`Return Cards with ${otherPseudonym}`} className="mb-5 overflow-hidden rounded-lg border border-foreground/10 bg-background">
      <div className="border-b border-foreground/10 px-4 py-3">
        <p className={sectionLabelClass}>Return Cards</p>
        <p className={`mt-1 ${helperTextClass}`}>
          Small signs sent while a fuller letter was still waiting. They are not replies.
        </p>
      </div>

      <ol className="divide-y divide-foreground/10">
        {cards.map((card) => {
          const senderLabel = card.senderId === viewerId ? 'You' : card.senderPseudonymSnapshot || otherPseudonym
          return (
            <li key={card.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-[14px] font-medium text-foreground">{senderLabel} sent a Return Card</p>
                  <span className={helperTextClass}>{formatDateTimeCompact(card.sentAt)}</span>
                </div>
                {card.message && (
                  <p className="mt-2 max-w-[52ch] font-serif text-[16px] leading-relaxed text-foreground/80">
                    “{card.message}”
                  </p>
                )}
                <Link
                  href={`/letters/${card.sourceLetterId}`}
                  className="mt-2 inline-block text-[13px] text-foreground/65 underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
                >
                  View the letter that was waiting
                </Link>
              </div>

              <LetterheadPostcard
                base={returnCardVersionToBaseContent(card.version)}
                revealLine=""
                backMessage={card.message ?? ''}
                senderPseudonym={card.senderPseudonymSnapshot}
              />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

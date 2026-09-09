'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { helperTextClass, primaryButtonClass, proseBodyClass, contextQuestionClass } from '@/app/profile/ui'
import Mindform from '@/app/mindform'
import QuestionInfoIcon from '@/app/question-info-icon'

export type DiscoveryEntry = {
  id: string
  userId: string
  questionId: string
  body: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  prompt: string
}

function identityLine(entry: DiscoveryEntry) {
  return [entry.country, entry.genderDisplay, entry.ageRange].filter(Boolean).join(' · ')
}

/**
 * The shared answer-card grammar used by both Minds/Explore and "Other
 * minds you might like to meet": identity + demographics + Question
 * sit OUTSIDE as context; the member's actual writing sits INSIDE, in a
 * visibly recessed surface, so a glance always distinguishes "who and
 * what this is about" from "what they actually wrote."
 */
export default function DiscoveryResults({ entries }: { entries: DiscoveryEntry[] }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)

  const openEntry = entries.find((e) => e.id === openId) ?? null

  useEffect(() => {
    if (!openEntry) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openEntry])

  return (
    <>
      <div className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-md border border-foreground/10 p-4">
            {/* OUTSIDE = context: identity, demographics, the Question.
                Mindform + pseudonym are ONE hit target (the profile
                link) — QuestionInfoIcon is a separate, genuinely
                distinct control, never nested inside it. */}
            <div className="flex items-start gap-3">
              <Link
                href={`/minds/${entry.userId}`}
                className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90"
              >
                <Mindform identifier={entry.userId} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{entry.pseudonym}</p>
                  <p className={helperTextClass}>{identityLine(entry)}</p>
                </div>
              </Link>
              <QuestionInfoIcon prompt={entry.prompt} />
            </div>

            {/* INSIDE = the actual writing, in a visibly recessed surface. */}
            <button
              type="button"
              onClick={() => setOpenId(entry.id)}
              className="mt-3 block w-full rounded-md bg-surface-shell p-4 text-left"
            >
              <p className={`line-clamp-4 whitespace-pre-wrap ${proseBodyClass}`}>{entry.body}</p>
            </button>
          </div>
        ))}
      </div>

      {openEntry && (
        <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpenId(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative flex w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-xl sm:rounded-lg sm:border sm:border-foreground/10"
          >
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
              <Link
                href={`/minds/${openEntry.userId}`}
                className="flex min-w-0 items-center gap-3 hover:opacity-90"
              >
                <Mindform identifier={openEntry.userId} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{openEntry.pseudonym}</p>
                  <p className={helperTextClass}>{identityLine(openEntry)}</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="shrink-0 rounded-full p-2 text-lg leading-none transition-colors hover:bg-foreground/[.04]"
              >
                ×
              </button>
            </div>

            <div className="border-b border-foreground/10 px-5 py-4">
              <p className={contextQuestionClass}>{openEntry.prompt}</p>
            </div>

            <div className="flex-1 overflow-y-auto bg-surface-shell px-5 py-5">
              <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{openEntry.body}</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-foreground/10 px-5 py-4">
              <button
                type="button"
                onClick={() => router.push(`/write/${openEntry.userId}?a=${openEntry.id}`)}
                className={primaryButtonClass}
              >
                Write to this mind
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

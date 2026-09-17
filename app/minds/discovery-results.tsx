'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { helperTextClass, primaryButtonClass, proseBodyClass, contextQuestionClass } from '@/app/profile/ui'
import Mindform from '@/app/mindform'
import QuestionInfoIcon from '@/app/question-info-icon'

// Post-onboarding corrections checkpoint (Section A/B) — People is a
// directory of PEOPLE, not a list of Question responses. `response` is
// optional: a person with no Flagship answer still gets a card, just
// without the response preview. The identity fields (userId, pseudonym,
// etc.) are never optional — every entry IS a person.
export type DiscoveryEntry = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  response: { id: string; body: string; prompt: string } | null
}

function identityLine(entry: DiscoveryEntry) {
  return [entry.country, entry.genderDisplay, entry.ageRange].filter(Boolean).join(' · ')
}

/**
 * The shared answer-card grammar used by both Minds/Explore and "Other
 * minds you might like to meet": identity + demographics + Question
 * sit OUTSIDE as context; the member's actual writing sits INSIDE, in a
 * visibly recessed surface, so a glance always distinguishes "who and
 * what this is about" from "what they actually wrote." A person with no
 * Flagship response gets the same identity row without the writing
 * surface — the whole card becomes the profile link instead, since
 * there's nothing to preview inline (Post-onboarding corrections
 * checkpoint, Section A/B).
 */
export default function DiscoveryResults({ entries }: { entries: DiscoveryEntry[] }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)

  const openEntry = entries.find((e) => e.userId === openId && e.response) ?? null

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
        {entries.map((entry) =>
          entry.response ? (
            <div key={entry.userId} className="rounded-md border border-foreground/10 p-4">
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
                <QuestionInfoIcon prompt={entry.response.prompt} />
              </div>

              {/* INSIDE = the actual writing, in a visibly recessed surface. */}
              <button
                type="button"
                onClick={() => setOpenId(entry.userId)}
                className="mt-3 block w-full rounded-md bg-surface-shell p-4 text-left"
              >
                <p className={`line-clamp-4 whitespace-pre-wrap ${proseBodyClass}`}>{entry.response.body}</p>
              </button>
            </div>
          ) : (
            // No Flagship response — a person is never hidden just because
            // they haven't answered one. The card is the identity row
            // alone, and the whole thing links straight to the existing,
            // approved profile experience (no response preview to show).
            <Link
              key={entry.userId}
              href={`/minds/${entry.userId}`}
              className="flex items-center gap-3 rounded-md border border-foreground/10 p-4 hover:opacity-90"
            >
              <Mindform identifier={entry.userId} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-foreground">{entry.pseudonym}</p>
                <p className={helperTextClass}>{identityLine(entry)}</p>
              </div>
            </Link>
          )
        )}
      </div>

      {openEntry?.response && (
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
              <p className={contextQuestionClass}>{openEntry.response.prompt}</p>
            </div>

            <div className="flex-1 overflow-y-auto bg-surface-shell px-5 py-5">
              <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{openEntry.response.body}</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-foreground/10 px-5 py-4">
              <button
                type="button"
                onClick={() => router.push(`/write/${openEntry.userId}?a=${openEntry.response!.id}`)}
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

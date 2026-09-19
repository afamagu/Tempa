'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { helperTextClass, primaryButtonClass, proseBodyClass, contextQuestionClass, quietLinkClass } from '@/app/profile/ui'
import Mindform from '@/app/mindform'
import QuestionInfoIcon from '@/app/question-info-icon'

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

function profileHref(userId: string, returnTo: string) {
  return returnTo
    ? `/minds/${userId}?returnTo=${encodeURIComponent(returnTo)}`
    : `/minds/${userId}`
}

export default function DiscoveryResults({
  entries,
  returnTo = '/minds',
}: {
  entries: DiscoveryEntry[]
  returnTo?: string
}) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const readableEntries = entries.filter((entry) => entry.response)
  const openIndex = readableEntries.findIndex((entry) => entry.userId === openId)
  const openEntry = openIndex >= 0 ? readableEntries[openIndex] : null
  const hasPrevious = openIndex > 0
  const hasNext = openIndex >= 0 && openIndex < readableEntries.length - 1

  function showPrevious() {
    if (hasPrevious) setOpenId(readableEntries[openIndex - 1].userId)
  }

  function showNext() {
    if (hasNext) setOpenId(readableEntries[openIndex + 1].userId)
  }

  useEffect(() => {
    if (!openEntry) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
      if (e.key === 'ArrowLeft' && openIndex > 0) setOpenId(readableEntries[openIndex - 1].userId)
      if (e.key === 'ArrowRight' && openIndex < readableEntries.length - 1) {
        setOpenId(readableEntries[openIndex + 1].userId)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openEntry, openIndex, readableEntries])

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    touchStartRef.current = null
    const touch = e.changedTouches[0]
    if (!start || !touch) return

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
    if (dx < 0) showNext()
    else showPrevious()
  }

  return (
    <>
      <div className="space-y-4">
        {readableEntries.map((entry) => (
          <div key={entry.userId} className="rounded-md border border-foreground/10 p-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => setOpenId(entry.userId)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-90"
                aria-label={`Read ${entry.pseudonym}'s response`}
              >
                <Mindform identifier={entry.userId} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{entry.pseudonym}</p>
                  <p className={helperTextClass}>{identityLine(entry)}</p>
                </div>
              </button>
              <QuestionInfoIcon prompt={entry.response!.prompt} />
            </div>

            <button
              type="button"
              onClick={() => setOpenId(entry.userId)}
              className="mt-3 block w-full rounded-md bg-surface-shell p-4 text-left"
              aria-label={`Open ${entry.pseudonym}'s response`}
            >
              <p className={`line-clamp-4 whitespace-pre-wrap ${proseBodyClass}`}>{entry.response!.body}</p>
            </button>
          </div>
        ))}
      </div>

      {openEntry?.response && (
        <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpenId(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${openEntry.pseudonym}'s response`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative flex w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-xl sm:rounded-lg sm:border sm:border-foreground/10"
          >
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Mindform identifier={openEntry.userId} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{openEntry.pseudonym}</p>
                  <p className={helperTextClass}>{identityLine(openEntry)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close and return to People"
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

            <div className="space-y-3 border-t border-foreground/10 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={showPrevious}
                    disabled={!hasPrevious}
                    aria-label="Previous response"
                    className="rounded-full px-3 py-2 text-lg leading-none transition-colors hover:bg-foreground/[.04] disabled:cursor-default disabled:opacity-25"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={showNext}
                    disabled={!hasNext}
                    aria-label="Next response"
                    className="rounded-full px-3 py-2 text-lg leading-none transition-colors hover:bg-foreground/[.04] disabled:cursor-default disabled:opacity-25"
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/write/${openEntry.userId}?a=${openEntry.response!.id}`)}
                  className={primaryButtonClass}
                >
                  Write to {openEntry.pseudonym}
                </button>
              </div>
              <Link href={profileHref(openEntry.userId, returnTo)} className={quietLinkClass}>
                View {openEntry.pseudonym}&rsquo;s profile
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

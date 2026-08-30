'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { helperTextClass, primaryButtonClass } from '@/app/profile/ui'

export type DiscoveryEntry = {
  id: string
  userId: string
  body: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  prompt: string
}

function identityLine(entry: DiscoveryEntry) {
  return [entry.pseudonym, entry.country, entry.genderDisplay, entry.ageRange]
    .filter(Boolean)
    .join(' · ')
}

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
      <div className="space-y-6">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setOpenId(entry.id)}
            className="block w-full space-y-3 rounded-md border border-black/10 dark:border-white/20 p-4 text-left active:bg-black/[.03] dark:active:bg-white/[.06] sm:hover:border-black/25 sm:dark:hover:border-white/35"
          >
            <p className={helperTextClass}>{entry.prompt}</p>
            <p className="line-clamp-6 whitespace-pre-wrap text-base leading-relaxed sm:line-clamp-4">
              {entry.body}
            </p>
            <p className={helperTextClass}>{identityLine(entry)}</p>
          </button>
        ))}
      </div>

      {openEntry && (
        <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpenId(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative flex w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-xl sm:rounded-lg sm:border sm:border-black/10 sm:dark:border-white/20"
          >
            <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-5 py-4">
              <p className={helperTextClass}>{openEntry.prompt}</p>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="shrink-0 rounded-full p-2 text-lg leading-none hover:bg-black/[.04] dark:hover:bg-white/[.08]"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <p className="whitespace-pre-wrap text-base leading-relaxed">
                {openEntry.body}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 dark:border-white/10 px-5 py-4">
              <p className={helperTextClass}>{identityLine(openEntry)}</p>
              <button
                type="button"
                onClick={() => router.push(`/write/${openEntry.userId}`)}
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

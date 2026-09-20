'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { helperTextClass } from '@/app/profile/ui'
import { formatDateTimeCompact } from '@/lib/format-date'
import {
  letterPreviewText,
  isRichBody,
  resolveLetterDirection,
  type ArchiveLetter,
} from '@/lib/letters'
import FormattedText from '@/app/letters/formatted-text'
import ArchiveActions from './archive-actions'

function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="3.5" y="5.5" width="17" height="14" rx="1.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="m5 17 4.5-4.5c.6-.6 1.4-.6 2 0L15 16l1.5-1.5c.6-.6 1.4-.6 2 0L21 17" />
    </svg>
  )
}

function PostcardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <rect x="15.5" y="8" width="4" height="3.2" rx="0.4" />
      <path d="M5 13h6M5 15.5h4" />
    </svg>
  )
}

export default function ArchiveList({
  letters,
  viewerId,
  otherUserId,
  otherPseudonym,
  viewerPseudonym,
}: {
  letters: ArchiveLetter[]
  viewerId: string
  otherUserId: string
  otherPseudonym: string
  viewerPseudonym: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pseudonymById = useMemo(
    () =>
      new Map([
        [viewerId, viewerPseudonym],
        [otherUserId, otherPseudonym],
      ]),
    [otherPseudonym, otherUserId, viewerId, viewerPseudonym]
  )
  const allSelected = letters.length > 0 && selected.size === letters.length

  if (letters.length === 0)
    return <p className={helperTextClass}>No visible letters with {otherPseudonym} yet.</p>

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section
      aria-label={`Letters with ${otherPseudonym}`}
      className="overflow-hidden rounded-lg border border-foreground/10 bg-background"
    >
      <div className="relative flex min-h-12 items-center gap-3 border-b border-foreground/10 px-3 sm:px-4">
        <input
          type="checkbox"
          aria-label="Select all letters"
          checked={allSelected}
          ref={(node) => {
            if (node) node.indeterminate = selected.size > 0 && !allSelected
          }}
          onChange={() =>
            setSelected(allSelected ? new Set() : new Set(letters.map((letter) => letter.id)))
          }
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <span className="flex-1 text-[12px] text-muted">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${letters.length} ${letters.length === 1 ? 'letter' : 'letters'} · newest first`}
        </span>
        <ArchiveActions letterIds={[...selected]} onRemoved={() => setSelected(new Set())} />
      </div>

      <ol className="divide-y divide-foreground/10">
        {letters.map((letter) => {
          const { senderName } = resolveLetterDirection(letter, pseudonymById)
          const senderLabel = letter.senderId === viewerId ? 'You' : senderName
          return (
            <li
              key={letter.id}
              className={`group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-foreground/[.025] sm:px-4 ${letter.isUnread ? 'bg-accent/[.035]' : ''}`}
            >
              <input
                type="checkbox"
                aria-label={`Select letter from ${senderLabel}`}
                checked={selected.has(letter.id)}
                onChange={() => toggle(letter.id)}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <Link
                href={`/letters/${letter.id}`}
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
              >
                <span
                  className={`truncate text-[13px] ${letter.isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/75'}`}
                >
                  {letter.isUnread && (
                    <span
                      aria-hidden="true"
                      className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    />
                  )}
                  {senderLabel}
                </span>
                <span className="col-span-2 min-w-0 truncate font-serif text-[14px] text-foreground/70 sm:col-span-1">
                  <FormattedText
                    text={letterPreviewText(letter.body)}
                    isRich={isRichBody(letter.body)}
                  />
                </span>
                <span className="row-start-1 flex shrink-0 items-center gap-1.5 text-[11px] text-muted sm:col-start-3">
                  {letter.momentCounts.photo > 0 && (
                    <span role="img" aria-label="Contains photos">
                      <PhotoIcon />
                    </span>
                  )}
                  {letter.hasLetterPostcard && (
                    <span role="img" aria-label="Contains a Postcard">
                      <PostcardIcon />
                    </span>
                  )}
                  {formatDateTimeCompact(letter.createdAt)}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { helperTextClass, primaryButtonClass, contextQuestionClass, quietLinkClass } from '@/app/profile/ui'
import AuthoredProse from '@/app/authored-prose'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import EditorialByline from '@/app/editorial-byline'
import QuestionInfoIcon from '@/app/question-info-icon'
import { recordAnswerRead } from '@/app/minds/[userId]/answer-reading'

export type DiscoveryEntry = {
  userId: string
  pseudonym: string
  country: string
  genderDisplay: string | null
  ageRange: string
  markUrl: string | null
  response: { id: string; body: string; prompt: string }
  writingStyleId?: string | null
  editorialTitle?: string | null
  languages?: string[]
  intent?: string[]
}

function identityLine(entry: DiscoveryEntry) {
  return [entry.country, entry.genderDisplay, entry.ageRange].filter(Boolean).join(' · ')
}

function profileHref(userId: string, returnTo: string, answerId?: string, reading = false) {
  const params = new URLSearchParams()
  if (returnTo) params.set('returnTo', returnTo)
  if (answerId) params.set('answer', answerId)
  if (reading) params.set('reading', '1')
  return `/room/${userId}${params.size ? `?${params}` : ''}`
}

function IdentityMark({ entry, size = 'sm' }: { entry: DiscoveryEntry; size?: 'sm' | 'md' }) {
  return (
    <ProfileIdentityMark
      identifier={entry.userId}
      markUrl={entry.markUrl}
      label={entry.markUrl ? `${entry.pseudonym}'s Mark` : undefined}
      size={size === 'sm' ? 'md' : 'lg'}
    />
  )
}

export default function DiscoveryResults({ entries, returnTo = '/room', profileLed = false, horizontal = false, questionReading = false, viewerId }: { entries: DiscoveryEntry[]; returnTo?: string; profileLed?: boolean; horizontal?: boolean; questionReading?: boolean; viewerId?: string }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const openIndex = entries.findIndex((entry) => entry.userId === openId)
  const openEntry = openIndex >= 0 ? entries[openIndex] : null
  const hasPrevious = openIndex > 0
  const hasNext = openIndex >= 0 && openIndex < entries.length - 1
  useEffect(() => { if (openEntry?.response.id) void recordAnswerRead(openEntry.response.id).catch(() => {}) }, [openEntry?.response.id])

  function showPrevious() { if (hasPrevious) setOpenId(entries[openIndex - 1].userId) }
  function showNext() { if (hasNext) setOpenId(entries[openIndex + 1].userId) }

  useEffect(() => {
    if (!openEntry) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
      if (e.key === 'ArrowLeft' && openIndex > 0) setOpenId(entries[openIndex - 1].userId)
      if (e.key === 'ArrowRight' && openIndex < entries.length - 1) setOpenId(entries[openIndex + 1].userId)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openEntry, openIndex, entries])

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
      <div className={horizontal ? 'flex gap-4' : profileLed ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}>
        {entries.map((entry) => (
          <article key={entry.userId} className={profileLed ? `rounded-lg border border-foreground/10 bg-surface-shell p-4 ${horizontal ? 'w-64 shrink-0 snap-start' : ''}` : 'border-b border-foreground/10 pb-4 last:border-b-0'}>
            {profileLed ? <Link href={profileHref(entry.userId, returnTo, entry.response.id)} className="block space-y-3">
              <div className="flex items-start gap-3"><IdentityMark entry={entry} /><div className="min-w-0"><p className="break-words text-sm font-semibold">{entry.pseudonym}</p><EditorialByline title={entry.editorialTitle} /><p className={helperTextClass}>{identityLine(entry)}</p></div></div>
              {entry.languages?.length ? <p className={helperTextClass}>{entry.languages.join(' · ')}</p> : null}
              {entry.response.body ? <AuthoredProse styleId={entry.writingStyleId ?? null}><p className="line-clamp-2 whitespace-pre-wrap text-base leading-6">{entry.response.body}</p></AuthoredProse> : null}
              <p className="text-xs font-medium text-foreground/60">Read {entry.pseudonym} →</p>
            </Link> :
            <button type="button" onClick={() => setOpenId(entry.userId)} className="block w-full text-left" aria-label={`Read ${entry.pseudonym}'s response`}>
              <div className="flex items-start gap-3">
                <IdentityMark entry={entry} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-foreground">{entry.pseudonym}</p>
                      <EditorialByline title={entry.editorialTitle} />
                      <p className={helperTextClass}>{identityLine(entry)}</p>
                    </div>
                    <QuestionInfoIcon prompt={entry.response.prompt} />
                  </div>
                  <AuthoredProse styleId={entry.writingStyleId ?? null}>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-base leading-6">{entry.response.body}</p>
                  </AuthoredProse>
                  <p className="mt-3 text-[12px] font-medium text-foreground/55">Read {entry.pseudonym} →</p>
                </div>
              </div>
            </button>}
          </article>
        ))}
      </div>

      {openEntry && (
        <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpenId(null)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label={`${openEntry.pseudonym}'s response`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="relative flex w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-xl sm:rounded-lg sm:border sm:border-foreground/10">
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <IdentityMark entry={openEntry} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{openEntry.pseudonym}</p>
                  <EditorialByline title={openEntry.editorialTitle} />
                  <p className={helperTextClass}>{identityLine(openEntry)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Close and return to The Room" className="shrink-0 rounded-full p-2 text-lg leading-none transition-colors hover:bg-foreground/[.04]">×</button>
            </div>
            <div className="border-b border-foreground/10 px-5 py-4"><p className={contextQuestionClass}>{openEntry.response.prompt}</p></div>
            <div className="flex-1 overflow-y-auto bg-surface-shell px-5 py-5">
              <AuthoredProse styleId={openEntry.writingStyleId ?? null}>
                <p className="whitespace-pre-wrap">{openEntry.response.body}</p>
              </AuthoredProse>
            </div>
            <div className="space-y-3 border-t border-foreground/10 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={showPrevious} disabled={!hasPrevious} aria-label="Previous response" className="rounded-full px-3 py-2 text-lg leading-none transition-colors hover:bg-foreground/[.04] disabled:cursor-default disabled:opacity-25">←</button>
                  <button type="button" onClick={showNext} disabled={!hasNext} aria-label="Next response" className="rounded-full px-3 py-2 text-lg leading-none transition-colors hover:bg-foreground/[.04] disabled:cursor-default disabled:opacity-25">→</button>
                </div>
                {questionReading && openEntry.userId === viewerId ? (
                  <Link
                    href={profileHref(openEntry.userId, returnTo, openEntry.response.id)}
                    className={primaryButtonClass}
                  >
                    Your answer
                  </Link>
                ) : questionReading ? (
                  <Link
                    href={`/write/${openEntry.userId}?a=${openEntry.response.id}&source=room&returnTo=${encodeURIComponent(profileHref(openEntry.userId, returnTo, openEntry.response.id, true))}`}
                    className={primaryButtonClass}
                  >
                    Reply privately
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => router.push(`/write/${openEntry.userId}?a=${openEntry.response.id}&source=room&returnTo=${encodeURIComponent(profileHref(openEntry.userId, returnTo, openEntry.response.id))}`)}
                    className={primaryButtonClass}
                  >
                    Write to {openEntry.pseudonym}
                  </button>
                )}
              </div>
              <Link href={profileHref(openEntry.userId, returnTo, openEntry.response.id)} className={quietLinkClass}>Read more from {openEntry.pseudonym}</Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

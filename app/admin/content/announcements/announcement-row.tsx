'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { archiveAnnouncement, deriveAnnouncementState, type AdminAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import { secondaryButtonClass, destructiveButtonClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass, adminBadgeClass } from '@/app/admin/admin-ui'
import { formatDateTimeFull } from '@/lib/format-date'
import AnnouncementBody from '@/app/announcement-body'
import AnnouncementComposer from './announcement-composer'

const STATE_LABEL: Record<ReturnType<typeof deriveAnnouncementState>, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
  archived: 'Archived',
}

/**
 * One Announcement's admin row (Section B7) — thumbnail, title,
 * derived state, start/end, and state-appropriate actions. Never a
 * hard-delete control for published history — Deactivate (archive) is
 * the only destructive-feeling action, and it only ever moves a row to
 * 'archived', never removes it.
 */
export default function AnnouncementRow({ announcement }: { announcement: AdminAnnouncement }) {
  const router = useRouter()
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const state = deriveAnnouncementState(announcement.status, announcement.startsAt, announcement.endsAt)

  useEffect(() => {
    let cancelled = false
    if (announcement.heroImagePath) {
      resolveAnnouncementImageUrl(createClient(), announcement.heroImagePath).then(({ url }) => {
        if (!cancelled) setThumbnailUrl(url)
      })
    }
    return () => {
      cancelled = true
    }
  }, [announcement.heroImagePath])

  async function handleDeactivate() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await archiveAnnouncement(createClient(), announcement.id)
    setBusy(false)
    if (actionError) {
      setError('Could not deactivate this announcement. Please try again.')
      return
    }
    router.refresh()
  }

  if (editing) {
    return <AnnouncementComposer initial={announcement} onDone={() => setEditing(false)} />
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="aspect-[3/2] w-24 shrink-0 overflow-hidden rounded-md border border-foreground/10 bg-surface-shell">
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={adminTableTextClass}>{announcement.title}</p>
            <span className={adminBadgeClass}>{STATE_LABEL[state]}</span>
          </div>
          {announcement.subtitle && <p className={adminMetadataClass}>{announcement.subtitle}</p>}
          <p className={adminMetadataClass}>
            {announcement.startsAt ? `Starts ${formatDateTimeFull(announcement.startsAt)}` : 'Starts immediately'}
            {announcement.endsAt ? ` · Ends ${formatDateTimeFull(announcement.endsAt)}` : ' · No end set'}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {previewing && (
        <div className="mx-auto max-w-sm space-y-3 rounded-md border border-foreground/10 p-4">
          {thumbnailUrl && (
            <div className="aspect-[3/2] overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <p className="font-serif text-xl font-medium text-foreground">{announcement.title}</p>
          {announcement.subtitle && <p className="font-serif italic text-foreground/70">{announcement.subtitle}</p>}
          <AnnouncementBody doc={announcement.contentJson} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPreviewing((v) => !v)} className={secondaryButtonClass}>
          {previewing ? 'Hide preview' : 'Preview'}
        </button>
        <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
          Edit
        </button>
        {(state === 'live' || state === 'scheduled') && (
          <button type="button" onClick={handleDeactivate} disabled={busy} className={destructiveButtonClass}>
            {busy ? 'Working…' : 'Deactivate'}
          </button>
        )}
      </div>
    </div>
  )
}

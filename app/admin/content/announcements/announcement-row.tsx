'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { updateAnnouncement, publishAnnouncement, archiveAnnouncement, type AdminAnnouncement } from '@/lib/announcements'
import { secondaryButtonClass, destructiveButtonClass, primaryButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass, adminBadgeClass } from '@/app/admin/admin-ui'
import { formatDateTimeFull } from '@/lib/format-date'

const STATUS_LABEL: Record<AdminAnnouncement['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AnnouncementRow({ announcement }: { announcement: AdminAnnouncement }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(announcement.title)
  const [body, setBody] = useState(announcement.body)
  const [startsAt, setStartsAt] = useState(toLocalInputValue(announcement.startsAt))
  const [endsAt, setEndsAt] = useState(toLocalInputValue(announcement.endsAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveEdit() {
    if (title.trim().length === 0 || body.trim().length === 0) {
      setError('A title and body are required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = await updateAnnouncement(
      supabase,
      announcement.id,
      title,
      body,
      startsAt ? new Date(startsAt).toISOString() : null,
      endsAt ? new Date(endsAt).toISOString() : null
    )
    setBusy(false)
    if (actionError) {
      setError('Could not save this announcement. Please try again.')
      return
    }
    setEditing(false)
    router.refresh()
  }

  async function handlePublish() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await publishAnnouncement(createClient(), announcement.id)
    setBusy(false)
    if (actionError) {
      setError('Could not publish this announcement. Please try again.')
      return
    }
    router.refresh()
  }

  async function handleArchive() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await archiveAnnouncement(createClient(), announcement.id)
    setBusy(false)
    if (actionError) {
      setError('Could not unpublish this announcement. Please try again.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <div>
                <label className={fieldLabelClass} htmlFor={`title-${announcement.id}`}>
                  Title
                </label>
                <input
                  id={`title-${announcement.id}`}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label className={fieldLabelClass} htmlFor={`body-${announcement.id}`}>
                  Body
                </label>
                <textarea
                  id={`body-${announcement.id}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className={fieldLabelClass} htmlFor={`starts-${announcement.id}`}>
                    Starts (optional)
                  </label>
                  <input
                    id={`starts-${announcement.id}`}
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass} htmlFor={`ends-${announcement.id}`}>
                    Ends (optional)
                  </label>
                  <input
                    id={`ends-${announcement.id}`}
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className={adminTableTextClass}>{announcement.title}</p>
              <p className={`mt-1 whitespace-pre-wrap ${adminTableTextClass}`}>{announcement.body}</p>
            </>
          )}
        </div>
        <span className={adminBadgeClass}>{STATUS_LABEL[announcement.status]}</span>
      </div>

      <p className={adminMetadataClass}>
        Created {formatDateTimeFull(announcement.createdAt)}
        {announcement.startsAt ? ` · starts ${formatDateTimeFull(announcement.startsAt)}` : ''}
        {announcement.endsAt ? ` · ends ${formatDateTimeFull(announcement.endsAt)}` : ''}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setTitle(announcement.title)
                setBody(announcement.body)
                setError(null)
              }}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="button" onClick={saveEdit} disabled={busy} className={primaryButtonClass}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={secondaryButtonClass}>
              Edit
            </button>
            {announcement.status !== 'published' ? (
              <button type="button" onClick={handlePublish} disabled={busy} className={primaryButtonClass}>
                {busy ? 'Working…' : 'Publish'}
              </button>
            ) : (
              <button type="button" onClick={handleArchive} disabled={busy} className={destructiveButtonClass}>
                {busy ? 'Working…' : 'Unpublish'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createAnnouncement } from '@/lib/announcements'
import { secondaryButtonClass, primaryButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'

/** Creates a draft announcement. Publishing is a separate, explicit
 * action (AnnouncementRow) — a new announcement never reaches Home the
 * instant it's created. */
export default function CreateAnnouncementForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Create announcement
      </button>
    )
  }

  async function handleCreate() {
    if (title.trim().length === 0 || body.trim().length === 0) {
      setError('A title and body are required.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: actionError } = await createAnnouncement(createClient(), title, body)
    setBusy(false)
    if (actionError) {
      setError('Could not create this announcement. Please try again.')
      return
    }
    setOpen(false)
    setTitle('')
    setBody('')
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div>
        <label className={fieldLabelClass} htmlFor="new-announcement-title">
          Title
        </label>
        <input
          id="new-announcement-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label className={fieldLabelClass} htmlFor="new-announcement-body">
          Body
        </label>
        <textarea
          id="new-announcement-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setTitle('')
            setBody('')
            setError(null)
          }}
          disabled={busy}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button type="button" onClick={handleCreate} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </div>
  )
}

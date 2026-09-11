'use client'

import { useState } from 'react'
import { secondaryButtonClass } from '@/app/profile/ui'
import AnnouncementComposer from './announcement-composer'

/** Toggles the shared composer (Section B6) in create mode. */
export default function CreateAnnouncementForm() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Create announcement
      </button>
    )
  }

  return <AnnouncementComposer onDone={() => setOpen(false)} />
}

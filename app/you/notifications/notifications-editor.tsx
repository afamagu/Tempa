'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setArrivalEmailPreference } from '@/lib/email-preferences'
import { helperTextClass } from '@/app/profile/ui'

/** Mirrors app/you/interests/interests-editor.tsx's shape: local state
 * seeded from the server-read value, an explicit Save action (no
 * autosave), and a generic error message on failure so a transient
 * write error never claims a save succeeded when it didn't. */
export default function NotificationsEditor({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    setSaved(false)
    setEnabled((prev) => !prev)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: saveError } = await setArrivalEmailPreference(supabase, enabled)
    setSaving(false)
    if (saveError) {
      setError('Could not save right now. Please try again.')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3 text-[15px] text-foreground">
        <span>Email me when a letter arrives</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          className="h-5 w-5 accent-accent"
          aria-label="Email me when a letter arrives"
        />
      </label>

      <p className={helperTextClass}>
        This email only ever says a letter has arrived and links back here — never the letter
        itself, a Moment, or a Postcard.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent text-accent-foreground px-4 py-2.5 text-[15px] font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !saving && <p className={helperTextClass}>Saved.</p>}
      </div>
    </div>
  )
}

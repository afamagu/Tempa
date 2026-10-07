'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setReplyReminderPreference } from '@/lib/reply-reminders'
import { helperTextClass } from '@/app/profile/ui'

export default function ReplyReminderPreference({
  initialRemindersEnabled,
  initialEmailEnabled,
  emailDeliveryAvailable,
}: {
  initialRemindersEnabled: boolean
  initialEmailEnabled: boolean
  emailDeliveryAvailable: boolean
}) {
  const router = useRouter()
  const [remindersEnabled, setRemindersEnabled] = useState(initialRemindersEnabled)
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setMaster(enabled: boolean) {
    setSaved(false)
    setRemindersEnabled(enabled)
    if (!enabled) setEmailEnabled(false)
  }

  function setEmail(enabled: boolean) {
    if (!emailDeliveryAvailable) return
    setSaved(false)
    setEmailEnabled(enabled)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await setReplyReminderPreference(supabase, {
      remindersEnabled,
      emailEnabled,
    })

    setSaving(false)
    if (saveError) {
      setError('Could not save right now. Please try again.')
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <section id="reply-reminders" className="scroll-mt-6 space-y-4 border-t border-foreground/10 pt-6">
      <div className="space-y-1">
        <h2 className="font-serif text-lg text-foreground">Reply reminders</h2>
        <p className={helperTextClass}>
          Tempa sends one quiet reminder when a letter moves beyond your writing rhythm. It never becomes a countdown and never repeats for the same letter.
        </p>
        <p className="text-[12px] leading-5 text-muted">
          On by default. Make this quieter whenever you prefer.
        </p>
      </div>

      <label className="flex items-start justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3 text-[15px] text-foreground">
        <span className="space-y-1">
          <span className="block">Remind me in Tempa</span>
          <span className="block text-[13px] leading-5 text-muted">
            If you send a Return Card, Tempa stays quiet for that waiting letter.
          </span>
        </span>
        <input
          type="checkbox"
          checked={remindersEnabled}
          onChange={(event) => setMaster(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
          aria-label="Remind me in Tempa when a letter passes my writing rhythm"
        />
      </label>

      <label className={`flex items-start justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3 text-[15px] ${remindersEnabled && emailDeliveryAvailable ? 'text-foreground' : 'text-muted'}`}>
        <span className="space-y-1">
          <span className="block">{emailDeliveryAvailable ? 'Email the reminder too' : 'Email reminders are paused during the pilot'}</span>
          <span className="block text-[13px] leading-5 text-muted">
            {emailDeliveryAvailable
              ? 'The email only says that a letter is still waiting. It never includes the letter itself.'
              : 'Your email preference is kept for later, but Tempa is not sending reply-reminder emails right now.'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={emailEnabled}
          disabled={!remindersEnabled || !emailDeliveryAvailable}
          onChange={(event) => setEmail(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent disabled:opacity-40"
          aria-label={emailDeliveryAvailable ? 'Email my reply reminder too' : 'Reply-reminder email delivery is paused'}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !saving && <p className={helperTextClass}>Saved.</p>}
      </div>
    </section>
  )
}

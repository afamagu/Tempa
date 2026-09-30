'use client'

import { useState, useTransition } from 'react'
import { readingLanguage } from '@/lib/reading-languages'
import { primaryButtonClass, helperTextClass } from '@/app/profile/ui'
import ReadingLanguagePicker from '@/app/reading-language-picker'
import { saveReadingLanguage } from '@/app/reading-language-actions'

/** Same shape as app/you/notifications/notifications-editor.tsx: local
 * choice seeded from the server value, an explicit Save, and a plain error
 * that never claims a save that didn't happen. */
export default function ReadingLanguageEditor({ initialCode }: { initialCode: string | null }) {
  const [saved, setSaved] = useState<string | null>(initialCode)
  const [chosen, setChosen] = useState<string | null>(initialCode)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [pending, startTransition] = useTransition()

  const current = readingLanguage(saved)
  const choice = readingLanguage(chosen)

  function handleSave() {
    if (!choice) return
    setStatus('idle')
    startTransition(async () => {
      const result = await saveReadingLanguage(choice.code)
      if (result.ok) {
        setSaved(result.code)
        setStatus('saved')
      } else {
        setStatus('error')
      }
    })
  }

  return (
    <div className="space-y-5">
      <p className="text-[15px] text-foreground">
        {current ? (
          <>
            Tempa translates into <span lang={current.code}>{current.nativeName}</span>
            {current.nativeName !== current.name && <span className="text-muted"> · {current.name}</span>}
          </>
        ) : (
          <span className="text-muted">You haven&rsquo;t chosen a reading language yet.</span>
        )}
      </p>

      <ReadingLanguagePicker
        value={chosen}
        onSelect={(code) => {
          setChosen(code)
          setStatus('idle')
        }}
        disabled={pending}
      />

      {status === 'error' && <p className="text-sm text-red-600">Could not save right now. Please try again.</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !choice || choice.code === saved}
          className={primaryButtonClass}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && <p className={helperTextClass}>Saved.</p>}
      </div>
    </div>
  )
}

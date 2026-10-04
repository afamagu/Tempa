'use client'

import { useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import {
  setMyWritingRhythm,
  writingRhythmCopy,
  writingRhythmOptions,
  type WritingRhythm,
} from '@/lib/writing-rhythm'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'

export default function RhythmEditor({
  initialRhythm,
}: {
  initialRhythm: WritingRhythm | null
}) {
  const locale = useLocale()
  const copy = useMemo(() => writingRhythmCopy(locale), [locale])
  const options = useMemo(() => writingRhythmOptions(locale), [locale])
  const [selected, setSelected] = useState<WritingRhythm | null>(initialRhythm)
  const [saved, setSaved] = useState<WritingRhythm | null>(initialRhythm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    if (!selected || saving || selected === saved) return
    setSaving(true)
    setMessage(null)
    const supabase = createClient()
    const { error } = await setMyWritingRhythm(supabase, selected)
    setSaving(false)

    if (error) {
      setMessage(
        locale.startsWith('fr') ? 'Impossible d’enregistrer pour le moment. Réessayez.' :
        locale.startsWith('es') ? 'No se pudo guardar ahora. Inténtalo de nuevo.' :
        locale.startsWith('pt') ? 'Não foi possível guardar agora. Tente novamente.' :
        'Could not save right now. Please try again.'
      )
      return
    }

    setSaved(selected)
    setMessage(
      locale.startsWith('fr') ? 'Enregistré.' :
      locale.startsWith('es') ? 'Guardado.' :
      locale.startsWith('pt') ? 'Guardado.' :
      'Saved.'
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{copy.heading}</p>
        <p className={helperTextClass}>{copy.help}</p>
      </div>

      <div className="grid gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 px-4 py-3 transition-colors hover:border-foreground/25 has-[:checked]:border-accent/50 has-[:checked]:bg-accent/[.04]"
          >
            <input
              type="radio"
              name="writing-rhythm-setting"
              value={option.value}
              checked={selected === option.value}
              onChange={() => {
                setSelected(option.value)
                setMessage(null)
              }}
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              <span className={`mt-0.5 block ${helperTextClass}`}>{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!selected || selected === saved || saving}
          className={secondaryButtonClass}
        >
          {saving ? 'Saving…' : 'Save rhythm'}
        </button>
        {message && <p role="status" className={helperTextClass}>{message}</p>}
      </div>
    </div>
  )
}

'use client'

import { useLocale } from 'next-intl'
import { writingRhythmCopy, writingRhythmOptions } from '@/lib/writing-rhythm'
import { fieldLabelClass, helperTextClass } from './ui'

export default function WritingRhythmChoice({ error }: { error?: string }) {
  const locale = useLocale()
  const copy = writingRhythmCopy(locale)
  const options = writingRhythmOptions(locale)

  return (
    <fieldset className="space-y-3" aria-describedby="writing-rhythm-help writing-rhythm-error">
      <legend className={fieldLabelClass}>{copy.heading}</legend>
      <p id="writing-rhythm-help" className={helperTextClass}>{copy.help}</p>
      <div className="grid gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 px-4 py-3 transition-colors hover:border-foreground/25 has-[:checked]:border-accent/50 has-[:checked]:bg-accent/[.04]"
          >
            <input
              type="radio"
              name="writing_rhythm"
              value={option.value}
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              <span className={`mt-0.5 block ${helperTextClass}`}>{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p id="writing-rhythm-error" className="text-xs text-red-600" role="alert">{error}</p>}
    </fieldset>
  )
}

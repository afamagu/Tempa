'use client'

import { useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import {
  setCorrespondenceRhythmOverride,
  writingRhythmLabel,
  writingRhythmOptions,
  type WritingRhythm,
} from '@/lib/writing-rhythm'
import { helperTextClass, quietLinkClass } from '@/app/profile/ui'

export default function CorrespondenceRhythmControl({
  correspondenceId,
  counterpartPseudonym,
  defaultRhythm,
  initialViewerRhythm,
  initialUsesOverride,
  counterpartRhythm,
}: {
  correspondenceId: string
  counterpartPseudonym: string
  defaultRhythm: WritingRhythm | null
  initialViewerRhythm: WritingRhythm | null
  initialUsesOverride: boolean
  counterpartRhythm: WritingRhythm | null
}) {
  const locale = useLocale()
  const options = useMemo(() => writingRhythmOptions(locale), [locale])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<WritingRhythm | 'default'>(
    initialUsesOverride ? initialViewerRhythm ?? 'default' : 'default'
  )
  const [effectiveRhythm, setEffectiveRhythm] = useState<WritingRhythm | null>(initialViewerRhythm)
  const [usesOverride, setUsesOverride] = useState(initialUsesOverride)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const viewerLabel = writingRhythmLabel(effectiveRhythm, locale)
  const counterpartLabel = writingRhythmLabel(counterpartRhythm, locale)
  const defaultLabel = writingRhythmLabel(defaultRhythm, locale)

  async function save() {
    if (saving) return
    setSaving(true)
    setMessage(null)
    const supabase = createClient()
    const override = selected === 'default' ? null : selected
    const { error } = await setCorrespondenceRhythmOverride(supabase, correspondenceId, override)
    setSaving(false)

    if (error) {
      setMessage('Could not save right now. Please try again.')
      return
    }

    setUsesOverride(override !== null)
    setEffectiveRhythm(override ?? defaultRhythm)
    setMessage('Saved.')
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {counterpartLabel && (
          <p className={helperTextClass}>{counterpartPseudonym} usually writes: {counterpartLabel}.</p>
        )}
        {viewerLabel && (
          <p className={helperTextClass}>
            Your rhythm here: {viewerLabel}{usesOverride ? ' · just for this correspondence' : ''}.
          </p>
        )}
        {!viewerLabel && (
          <p className={helperTextClass}>You have not chosen a writing rhythm yet.</p>
        )}
      </div>

      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMessage(null) }} className={quietLinkClass}>
          Adjust your rhythm
        </button>
      ) : (
        <div className="space-y-3 rounded-md border border-foreground/10 p-4">
          <p className={helperTextClass}>
            This changes only your pace with {counterpartPseudonym}. It is not a deadline.
          </p>

          <div className="grid gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 px-3 py-2.5">
              <input
                type="radio"
                name={`rhythm-${correspondenceId}`}
                checked={selected === 'default'}
                onChange={() => setSelected('default')}
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-sm text-foreground">
                Use my usual rhythm{defaultLabel ? ` · ${defaultLabel}` : ''}
              </span>
            </label>

            {options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 px-3 py-2.5">
                <input
                  type="radio"
                  name={`rhythm-${correspondenceId}`}
                  checked={selected === option.value}
                  onChange={() => setSelected(option.value)}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className={`block ${helperTextClass}`}>{option.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={saving || (selected === 'default' && defaultRhythm === null)} className={quietLinkClass}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className={quietLinkClass}>Cancel</button>
          </div>
        </div>
      )}

      {message && <p role="status" className={helperTextClass}>{message}</p>}
    </div>
  )
}

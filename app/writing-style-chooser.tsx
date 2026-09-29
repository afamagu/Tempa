'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { saveMyWritingStyle } from '@/lib/writing-style-data'
import {
  WRITING_STYLE_LIST,
  WRITING_STYLES,
  composeProse,
  previewExcerpt,
  type WritingStyleId,
} from '@/lib/writing-style'
import { splitParagraphs } from '@/lib/moments'
import { helperTextClass, primaryButtonClass, quietLinkClass } from '@/app/profile/ui'
import AuthoredProse from '@/app/authored-prose'

const CARD_EXCERPT_CHARS = 150

/**
 * Writing Style chooser — the same six choices wherever a member makes
 * this decision: onboarding step 4, the one-time choice for members who
 * predate Writing Styles, and You → Writing style.
 *
 * The member's own words are the preview. Six equal options, one quiet
 * selected state, one larger preview of the selected style; nothing to
 * configure — Tempa does the typesetting.
 *
 * Native radio inputs carry the semantics: arrow keys move between
 * styles, and each is announced by name with its checked state. The six
 * repeated excerpts are presentation only (aria-hidden); the larger
 * preview below is the readable one.
 */
export default function WritingStyleChooser({
  sample,
  sampleIsOwn,
  initialStyleId = null,
  mode,
  destination,
  heading,
  intro,
}: {
  sample: string
  sampleIsOwn: boolean
  initialStyleId?: WritingStyleId | null
  mode: 'onboarding' | 'settings'
  /** Onboarding: where to continue after saving (already validated). */
  destination?: string
  heading: string
  intro: string
}) {
  const router = useRouter()
  const groupName = useId()
  const previewId = useId()
  const [selected, setSelected] = useState<WritingStyleId | null>(initialStyleId)
  const [saved, setSaved] = useState<WritingStyleId | null>(initialStyleId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const cardExcerpt = previewExcerpt(sample, CARD_EXCERPT_CHARS) ?? sample
  const previewParagraphs = splitParagraphs(sample)
  const { roles } = composeProse(previewParagraphs)
  const unchanged = mode === 'settings' && selected === saved

  async function handleSave() {
    if (!selected || saving || unchanged) return
    setSaving(true)
    setError(null)
    setJustSaved(false)
    const result = await saveMyWritingStyle(createClient(), selected)
    if (!result.ok) {
      setSaving(false)
      setError('We couldn’t save that just now. Please try again.')
      return
    }
    if (mode === 'onboarding') {
      // Stay in the pending state while navigating on.
      router.replace(destination ?? '/home')
      router.refresh()
      return
    }
    setSaving(false)
    setSaved(result.styleId)
    setJustSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3 text-center">
        <h1 className="font-serif text-[28px] font-medium leading-tight sm:text-[32px]">{heading}</h1>
        <p className="text-[15px] leading-relaxed text-foreground/75">{intro}</p>
        {!sampleIsOwn && <p className={helperTextClass}>A few lines to begin with — your own words will take this shape.</p>}
      </header>

      <fieldset>
        <legend className="sr-only">How your writing appears</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WRITING_STYLE_LIST.map((style) => {
            const isSelected = selected === style.id
            return (
              <label
                key={style.id}
                className={[
                  'group relative flex cursor-pointer flex-col rounded-md border p-3 transition-colors motion-reduce:transition-none sm:p-4',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background',
                  isSelected
                    ? 'border-accent bg-accent/[.06]'
                    : 'border-foreground/12 hover:border-foreground/30',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={style.id}
                  checked={isSelected}
                  onChange={() => {
                    setSelected(style.id)
                    setJustSaved(false)
                  }}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-foreground">
                  {style.name}
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full transition-colors motion-reduce:transition-none ${
                      isSelected ? 'bg-accent' : 'bg-transparent'
                    }`}
                  />
                </span>
                <span aria-hidden="true" className="mt-2 block min-h-0">
                  <AuthoredProse styleId={style.id} size="compact">
                    <span className="line-clamp-4 whitespace-pre-line break-words">{cardExcerpt}</span>
                  </AuthoredProse>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <section aria-labelledby={previewId} className="space-y-2">
        {selected ? (
          <>
            <p id={previewId} className={helperTextClass}>
              Preview · {WRITING_STYLES[selected].name}
            </p>
            <div className="max-h-[22rem] overflow-y-auto rounded-md bg-surface-shell p-4 sm:p-5">
              <AuthoredProse styleId={selected} opening measure>
                {previewParagraphs.map((paragraph, index) => (
                  <p
                    key={index}
                    className={`wp-block whitespace-pre-wrap${roles[index] === 'opening' ? ' wp-opening' : ''}`}
                    data-wp-role={roles[index]}
                  >
                    {paragraph}
                  </p>
                ))}
              </AuthoredProse>
            </div>
          </>
        ) : (
          <p id={previewId} className={`${helperTextClass} text-center`}>
            Choose one to see it at full size.
          </p>
        )}
      </section>

      <div className="flex flex-col items-center gap-3">
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {mode === 'settings' && justSaved && (
          <p role="status" className={helperTextClass}>
            Saved. Your writing will appear this way from now on.
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!selected || saving || unchanged}
          className={`${primaryButtonClass} min-w-[10rem]`}
        >
          {saving ? 'Saving…' : mode === 'onboarding' ? 'Continue' : 'Save'}
        </button>
        {mode === 'settings' && (
          <Link href="/you" className={quietLinkClass}>
            Back to You
          </Link>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  deleteCorrespondencePrivateMemory,
  saveCorrespondencePrivateMemory,
} from '@/lib/private-memory'
import { helperTextClass, quietLinkClass, secondaryButtonClass } from '@/app/profile/ui'

const MAX_NOTE_LENGTH = 4000

export default function PrivateMemoryControl({
  correspondenceId,
  counterpartPseudonym,
  initialNote,
  latestLetterContext,
}: {
  correspondenceId: string
  counterpartPseudonym: string
  initialNote: string | null
  latestLetterContext: {
    senderLabel: string
    excerpt: string
    href: string
  } | null
}) {
  const [open, setOpen] = useState(Boolean(initialNote))
  const [note, setNote] = useState(initialNote ?? '')
  const [savedNote, setSavedNote] = useState(initialNote ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    const trimmed = note.trim()
    if (!trimmed || trimmed.length > MAX_NOTE_LENGTH || saving) return

    setSaving(true)
    setMessage(null)
    const supabase = createClient()
    const result = await saveCorrespondencePrivateMemory(
      supabase,
      correspondenceId,
      note
    )
    setSaving(false)

    if (result.error) {
      setMessage('Could not save your private note right now. Please try again.')
      return
    }

    setSavedNote(note)
    setMessage('Saved. Only you can see this.')
  }

  async function clear() {
    if (saving || !savedNote) return
    const ok = window.confirm(
      `Clear your private note about this correspondence with ${counterpartPseudonym}?`
    )
    if (!ok) return

    setSaving(true)
    setMessage(null)
    const supabase = createClient()
    const result = await deleteCorrespondencePrivateMemory(supabase, correspondenceId)
    setSaving(false)

    if (result.error) {
      setMessage('Could not clear your private note right now. Please try again.')
      return
    }

    setNote('')
    setSavedNote('')
    setMessage('Private note cleared.')
    setOpen(false)
  }

  const changed = note !== savedNote
  const valid = note.trim().length > 0 && note.length <= MAX_NOTE_LENGTH

  return (
    <section
      aria-label="Private Memory"
      className="space-y-3 border-t border-foreground/10 pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[15px] font-medium text-foreground">Private Memory</p>
          <p className={helperTextClass}>
            A note for yourself about this correspondence. {counterpartPseudonym} cannot see it.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            className={quietLinkClass}
            onClick={() => {
              setOpen(true)
              setMessage(null)
            }}
          >
            {savedNote ? 'View or edit' : 'Add a private note'}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          {latestLetterContext && (
            <div className="rounded-md bg-foreground/[.025] px-3 py-2.5">
              <p className={helperTextClass}>Recent letter · {latestLetterContext.senderLabel}</p>
              <p className="mt-1 line-clamp-2 font-serif text-[14px] leading-relaxed text-foreground/70">
                {latestLetterContext.excerpt}
              </p>
              <a href={latestLetterContext.href} className={quietLinkClass}>
                Read that letter
              </a>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-foreground">Only you can see this</span>
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                setMessage(null)
              }}
              maxLength={MAX_NOTE_LENGTH}
              rows={5}
              placeholder="Anything you want to remember for the next letter…"
              className="w-full resize-y rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={helperTextClass}>{note.length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()}</span>
            <div className="flex flex-wrap items-center gap-3">
              {savedNote && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={clear}
                  className="text-[13px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Clear note
                </button>
              )}
              <button
                type="button"
                disabled={saving || !changed || !valid}
                onClick={save}
                className={secondaryButtonClass}
              >
                {saving ? 'Saving…' : 'Save private note'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setNote(savedNote)
                  setOpen(Boolean(savedNote))
                  setMessage(null)
                }}
                className={quietLinkClass}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {message && <p role="status" className={helperTextClass}>{message}</p>}
    </section>
  )
}

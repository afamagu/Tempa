'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sendReturnCard } from '@/lib/return-cards'
import type { PostcardCatalogEntry } from '@/lib/postcards'
import {
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  systemBodyClass,
  systemHeadingClass,
} from '@/app/profile/ui'
import PostcardPicker from './postcard-picker'
import PostcardThumbnail from '@/app/letters/postcard-thumbnail'

const NOTE_MAX = 200

export default function ReturnCardAction({
  sourceLetterId,
  postcards,
  otherPseudonym,
}: {
  sourceLetterId: string
  postcards: PostcardCatalogEntry[]
  otherPseudonym: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (postcards.length === 0) return null

  const selected = selectedKey ? postcards.find((postcard) => postcard.key === selectedKey) ?? null : null

  async function send() {
    if (!selected || sending) return
    setSending(true)
    setError(null)

    const result = await sendReturnCard(createClient(), {
      sourceLetterId,
      postcardKey: selected.key,
      message: note.trim() || null,
    })

    if (result.error) {
      setSending(false)
      setError(
        result.error.code === '23505'
          ? 'A Return Card has already been sent for this letter.'
          : 'This Return Card is no longer available to send. The correspondence may have changed.'
      )
      return
    }

    setOpen(false)
    setSending(false)
    router.refresh()
  }

  return (
    <>
      <section className="mt-6 rounded-md border border-foreground/10 bg-background px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-[15px] font-medium text-foreground">Still meaning to write?</p>
            <p className={`mt-1 ${helperTextClass}`}>
              Send {otherPseudonym} a Return Card — a small sign that you&apos;re still here. It does not count as a reply; their letter remains waiting for your letter.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} shrink-0`}>
            Send a Return Card
          </button>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 sm:px-6">
            <div>
              <p className={systemHeadingClass}>Return Card</p>
              <p className={helperTextClass}>A sign of continued intent, not a reply.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={sending}
              className="text-[13px] text-muted underline underline-offset-4"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto w-full max-w-lg space-y-6">
              {selected ? (
                <>
                  <div className="rounded-md border border-foreground/10 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-foreground">{selected.title}</p>
                        <p className={`mt-1 ${helperTextClass}`}>{selected.collection}</p>
                      </div>
                      <PostcardThumbnail
                        frontImagePath={selected.frontImagePath}
                        onOpen={() => setPicking(true)}
                        ariaLabel="Change Return Card Postcard"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPicking(true)}
                      className="mt-3 text-[13px] text-foreground/70 underline underline-offset-4"
                    >
                      Choose a different Postcard
                    </button>
                  </div>

                  <div>
                    <label htmlFor="return-card-note" className="block text-[15px] font-medium text-foreground">
                      Add a short note <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <textarea
                      id="return-card-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={NOTE_MAX}
                      rows={4}
                      placeholder="I'm still here. A proper letter is coming."
                      className="mt-2 w-full resize-y rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                    />
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className={helperTextClass}>This note is part of the Return Card, not a substantive reply.</p>
                      <span className={`${helperTextClass} shrink-0`}>{note.length}/{NOTE_MAX}</span>
                    </div>
                  </div>

                  <div className="rounded-md bg-foreground/[.035] px-4 py-3">
                    <p className={systemBodyClass}>
                      Sending this will not mark {otherPseudonym}&apos;s letter replied, change whose turn it is, or reset your writing rhythm.
                    </p>
                  </div>

                  {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}
                </>
              ) : (
                <div className="rounded-md border border-dashed border-foreground/20 px-4 py-8 text-center">
                  <p className="text-[15px] text-foreground">Choose a complimentary Postcard for your Return Card.</p>
                  <button type="button" onClick={() => setPicking(true)} className={`${secondaryButtonClass} mt-4`}>
                    Choose Postcard
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-foreground/10 px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3">
              <button type="button" onClick={() => setOpen(false)} disabled={sending} className={secondaryButtonClass}>
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!selected || sending}
                className={primaryButtonClass}
              >
                {sending ? 'Sending…' : 'Send Return Card'}
              </button>
            </div>
          </div>

          {picking && (
            <div className="fixed inset-0 z-[60] overflow-y-auto bg-background p-4 sm:p-6">
              <PostcardPicker
                postcards={postcards}
                strictCatalog
                onSelect={(key) => {
                  setSelectedKey(key)
                  setPicking(false)
                  setError(null)
                }}
                onCancel={() => setPicking(false)}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

'use client'

import { useEffect } from 'react'
import PostcardObject from '@/app/letters/postcard-object'
import {
  helperTextClass,
  secondaryButtonClass,
  tertiaryButtonClass,
  primaryButtonClass,
  inputClass,
  sectionLabelClass,
} from '@/app/profile/ui'
import {
  resolveLetterPostcardDisplay,
  REVEAL_LINE_MAX_LENGTH,
  POSTCARD_BACK_MESSAGE_MAX_LENGTH,
  type LetterPostcardDraft,
} from '@/lib/moments'
import { postcardEntryToBaseContent, type PostcardCatalogEntry } from '@/lib/postcards'

/**
 * Letter-level Postcards V1 (2026-09-13) — the composer's own Postcard
 * editing surface, opened by tapping the attached Postcard in
 * PostcardComposerSlot. Deliberately NOT the generic Moment viewer
 * (MomentDisplay) — this is an editing experience, and reuses the real
 * Postcard visual shell entirely, through ONE single PostcardObject:
 *
 * - FRONT: the real, unmodified PostcardObject front/Living-Reveal
 *   preview — no parallel reimplementation of that state machine.
 * - BACK (writing surface): live UX repair (2026-09-14) — previously
 *   this rendered a SECOND, separate PostcardBack below the preview
 *   (disconnected from the card's own "Turn over" control, which
 *   flipped to a plain, non-editable back instead — the confirmed root
 *   cause of "the sender cannot type on the back"). PostcardObject now
 *   accepts an `editableBack` prop and forwards it to its OWN internal
 *   PostcardBack, so tapping Turn over on THIS card reveals the real,
 *   writable surface directly — one card, one back, no separate/
 *   duplicate block, no undocumented gesture. Writing happens directly
 *   inside the actual back layout (stamp, postmark, divider all still
 *   rendered exactly as always), never a generic "Message: [input]"
 *   form.
 *
 * Every keystroke calls `onChange` immediately — the caller
 * (moments-composer.tsx) holds the actual draft state and autosaves it
 * exactly like the letter body already does on every transaction; this
 * component itself has no local draft copy to keep in sync or discard.
 * "Done" only ever closes this view — nothing here sends, and Change
 * postcard / Remove both operate on the draft alone, with no payment or
 * ownership behavior of any kind.
 */
export default function PostcardEditor({
  draft,
  catalogEntry,
  senderPseudonym,
  onChange,
  onChangePostcard,
  onRemove,
  onDone,
  startOnBack,
}: {
  draft: LetterPostcardDraft
  /** Admin Phase 2A-2 — the live, active DB catalogue entry matching
   * draft.postcardKey, resolved by the caller (moments-composer.tsx)
   * from lib/postcards.ts's getActivePostcards. Null when the key is no
   * longer in the active catalogue (e.g. deactivated mid-draft) — shown
   * as the same honest "no longer available" message as an unknown key
   * always has been. */
  catalogEntry: PostcardCatalogEntry | null
  /** Pre-migration audit correction (2026-09-14) — the real sending
   * member's own pseudonym, shown as the Postcard's "— <name>"
   * signature (never the catalog's own fictional demo name). See
   * resolveLetterPostcardDisplay's own doc comment for why this is
   * resolved live by the caller, never snapshotted. */
  senderPseudonym: string
  onChange: (draft: LetterPostcardDraft) => void
  onChangePostcard: () => void
  onRemove: () => void
  onDone: () => void
  /** Production back-editing UX defect (2026-09-15) — true when the
   * caller opened this editor specifically because the back still needs
   * writing (moments-composer.tsx sets this only for its own
   * onEditPostcard path, never for the ordinary composer-slot edit).
   * Forwarded straight through to PostcardObject's own
   * `initialShowingBack`. */
  startOnBack?: boolean
}) {
  const postcard = catalogEntry
    ? resolveLetterPostcardDisplay(postcardEntryToBaseContent(catalogEntry), {
        revealLine: draft.revealLine,
        backMessage: draft.backMessage,
        senderPseudonym,
      })
    : null

  // Production back-editing UX defect (2026-09-15) — this editor can now
  // be reopened from inside LetterPreview (its blocked-Send control, or
  // the postcard thumbnail itself), which is stacked one z-index below
  // (fixed inset-0 z-50 here vs. z-40 there) and ALSO listens for Escape
  // to close itself. Without its own handler, Escape would bubble
  // straight to Preview's listener and close Preview instead of this
  // editor — stopPropagation keeps the two independent, exactly mirroring
  // the Escape-to-close convention already established by LetterPreview/
  // MomentDisplay/LetterheadPostcard's own overlays.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDone()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onDone])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 sm:px-6">
        <p className={sectionLabelClass}>Postcard</p>
        <button type="button" onClick={onDone} aria-label="Close postcard editor" className={helperTextClass}>
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-sm space-y-6">
          {postcard ? (
            <>
              <PostcardObject
                postcard={postcard}
                editableBack={{
                  value: draft.backMessage,
                  onChange: (value) => onChange({ ...draft, backMessage: value }),
                  maxLength: POSTCARD_BACK_MESSAGE_MAX_LENGTH,
                }}
                initialShowingBack={startOnBack}
              />
              <p className={helperTextClass}>Turn over to write on the back.</p>
            </>
          ) : (
            <p className={helperTextClass}>This postcard is no longer available.</p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="postcard-reveal-line" className={sectionLabelClass}>
              A few words for the reveal
            </label>
            <p className={helperTextClass}>Appears while the postcard comes alive.</p>
            <input
              id="postcard-reveal-line"
              type="text"
              value={draft.revealLine}
              onChange={(e) => onChange({ ...draft, revealLine: e.target.value })}
              maxLength={REVEAL_LINE_MAX_LENGTH}
              placeholder="A few words, just for them…"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-foreground/10 px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-sm flex-wrap items-center gap-3">
          <button type="button" onClick={onChangePostcard} className={secondaryButtonClass}>
            Change postcard
          </button>
          {/* Release Polish Pass — toned down from destructiveButtonClass
              (red): removing an unsent Postcard DRAFT is fully
              reversible (the sender can just re-attach one), so red is
              reserved for genuinely destructive, consequential actions
              elsewhere — this is tertiary, not alarming. */}
          <button type="button" onClick={onRemove} className={tertiaryButtonClass}>
            Remove
          </button>
          <button type="button" onClick={onDone} className={`${primaryButtonClass} ml-auto`}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

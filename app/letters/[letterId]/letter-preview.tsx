'use client'

import { useEffect } from 'react'
import { sectionLabelClass, metadataTextClass, helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import LetterBody from './letter-body'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import type { Moment, LetterPostcardDraft } from '@/lib/moments'

/**
 * WRITE → PREVIEW → SEND, Checkpoint (2026-09-08) — a deliberate, full
 * reading state the sender opens before ever sending, showing the
 * letter through the REAL production reading grammar: this renders the
 * actual LetterBody (paragraphs, paper surface, inline Photo tokens, and
 * — for a legacy inline postcardMoment only — PostcardObject/Living
 * Reveal/Turn over/Replay) with zero changes to LetterBody itself.
 * Letter-Level Postcards V1 (2026-09-13) adds the NEW letter-level
 * Postcard in its own canonical letterhead slot (LetterheadPostcard,
 * shared verbatim with the delivered reader) — rendered here, ABOVE
 * LetterBody, never inside it, since it's no longer paragraph-positioned
 * content at all.
 *
 * Purely an overlay on top of the still-mounted composer/editor — it
 * never touches editor state, never re-parses or rehydrates the draft,
 * and never triggers autosave/serialization of any kind. Both `onClose`
 * (top X) and `onBack` do the exact same thing: dismiss this overlay and
 * return to the composer exactly as it was, with the SAME live editor
 * instance still mounted underneath the whole time — there is nothing
 * here that could lose text, Photo Moments, or the selected Postcard,
 * because nothing here ever touched them in the first place.
 *
 * `onSend` is the composer's own existing `handleSend` — passed straight
 * through, never duplicated. This component has no send/RPC logic of
 * its own at all.
 *
 * Z-index note: intentionally BELOW MomentDisplay's own inline Photo/
 * Postcard viewer overlay (z-50) and PhotoMomentViewer (z-110), both of
 * which LetterBody can open from inside this Preview (tapping a Photo
 * token, or opening the attached Postcard) — Preview must sit under
 * those, not compete with them, so tapping a Moment inside Preview
 * behaves exactly like tapping one in a real delivered letter.
 */
export default function LetterPreview({
  body,
  moments,
  postcard,
  senderPseudonym,
  recipientPseudonym,
  onClose,
  onSend,
  sending,
  sendBlockedReason,
  onEditPostcard,
  error,
}: {
  body: string
  moments: Moment[]
  /** Letter-Level Postcards V1 (2026-09-13) — the whole letter's one
   * optional Postcard draft, entirely separate from `moments`. Rendered
   * through LetterheadPostcard, the SAME canonical enclosure slot the
   * delivered reader uses — never a Preview-only implementation. null
   * when no Postcard is attached; a legacy inline postcardMoment (if
   * this draft predates this checkpoint) still arrives via `moments`
   * and renders inline through LetterBody exactly as before — the two
   * are independent and both remain supported. */
  postcard: LetterPostcardDraft | null
  /** Pre-migration audit correction (2026-09-14) — the real sending
   * member's own pseudonym, shown on the attached Postcard's back
   * (never the catalog's fictional demo name). Unused when `postcard`
   * is null. */
  senderPseudonym: string
  recipientPseudonym: string
  onClose: () => void
  onSend: () => void
  sending: boolean
  /** Pre-migration audit correction (2026-09-14), Part 4 — non-null
   * when a precondition for sending isn't met yet (currently: an
   * attached Postcard with a blank sender-written back). Disables Send
   * and shows this exact restrained, muted instruction instead of the
   * button — deliberately NOT `error` styling: this isn't a failure,
   * it's guidance toward a state the sender can immediately fix. */
  sendBlockedReason?: string | null
  /** Production back-editing UX defect (2026-09-15) — reopens the SAME
   * PostcardEditor moments-composer.tsx already owns (passed straight
   * through as `() => setPostcardEditorOpen(true)`, never a second
   * implementation). PostcardEditor renders `fixed inset-0 z-50`, above
   * this component's own `z-40`, so opening it simply stacks it on top
   * of the still-mounted Preview underneath — closing it (Done/Change
   * postcard/Remove all already just call `setPostcardEditorOpen(false)`)
   * naturally reveals this exact same Preview again, unchanged, with no
   * new close/reopen logic needed here. Forwarded to LetterheadPostcard
   * as `onEditRequest` (its thumbnail becomes the second way in, besides
   * the explicit "Write on postcard" control below) and used directly by
   * the blocked-Send control. Omitted only if a caller has no Postcard
   * editing surface to offer (never actually omitted by moments-
   * composer.tsx today). */
  onEditPostcard?: () => void
  error?: string | null
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 sm:px-6">
        <p className={sectionLabelClass}>Preview</p>
        <button type="button" onClick={onClose} aria-label="Close preview" className={helperTextClass}>
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-xl space-y-3">
          <p className={metadataTextClass}>To {recipientPseudonym}</p>
          {postcard && (
            <LetterheadPostcard
              postcardKey={postcard.postcardKey}
              revealLine={postcard.revealLine}
              backMessage={postcard.backMessage}
              senderPseudonym={senderPseudonym}
              onEditRequest={onEditPostcard}
            />
          )}
          <LetterBody body={body} moments={moments} />
        </div>
      </div>

      <div className="border-t border-foreground/10 px-4 py-4 sm:px-6">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {!error && sendBlockedReason && (
          <div className="mb-3 space-y-1">
            <p className={helperTextClass}>{sendBlockedReason}</p>
            {onEditPostcard && (
              <button type="button" onClick={onEditPostcard} className={`${helperTextClass} underline`}>
                Write on postcard
              </button>
            )}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-xl gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Back to letter
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || Boolean(sendBlockedReason)}
            className={primaryButtonClass}
          >
            {/* Send-feedback audit (2026-09-13): the disable/label-swap
                mechanics here were already correct (canSendLetter's own
                `submitting` gate plus this literal `disabled={sending}`
                — a genuine double-submission was never actually
                possible). What was missing is visible ongoing motion
                for the several seconds a real send can take — a plain
                static label swap can read as "did my click even
                register?" No dedicated loading-indicator component
                exists anywhere in this codebase to reuse, so this is
                the smallest restrained addition: Tailwind's own
                built-in pulse on the label text alone, never a spinner,
                progress bar, or other louder chrome. */}
            <span className={sending ? 'animate-pulse' : undefined}>{sending ? 'Sending…' : 'Send letter'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

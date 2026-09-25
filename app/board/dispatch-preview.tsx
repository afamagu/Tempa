'use client'

import { useEffect } from 'react'
import {
  sectionLabelClass,
  sectionTitleClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import type { DispatchIdentity } from '@/lib/dispatch-identity'
import DispatchIdentityLabel from './dispatch-identity-label'
import TopicChips from './topic-chips'
import DispatchBody from './dispatch-body'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import type { DispatchMoment } from '@/lib/dispatches'
import type { LetterPostcardDraft } from '@/lib/moments'
import { postcardEntryToBaseContent, type PostcardCatalogEntry } from '@/lib/postcards'

/**
 * WRITE → PREVIEW → PUBLISH (Dispatch composing checkpoint) — the same
 * philosophy as app/letters/[letterId]/letter-preview.tsx: a deliberate,
 * full reading state the author opens before ever publishing, built from
 * the REAL production reading grammar rather than a second, drifting
 * implementation. Reuses DispatchBody (paragraphs, paper surface, inline
 * Photo tokens — the exact component the authenticated reader and the
 * public share view both already use, unmodified) and LetterheadPostcard
 * (the exact component both readers use for an attached Postcard) — this
 * is deliberately NOT a fake Board page: no Worth Reading, no Replies, no
 * Read Next, no report/share controls, nothing a real reader could act
 * on. It shows only what a reader would actually see, so the author can
 * make an honest judgment before Postcards' own immutability locks in.
 *
 * Purely an overlay on top of the still-mounted composer/editor — same
 * as LetterPreview, it never touches editor state and never triggers
 * autosave/serialization of any kind. Closing (top "Close" or "Back to
 * editing") both just dismiss this overlay; the live editor instance
 * underneath was never touched, so nothing here can lose text, Moments,
 * or the selected Postcard draft.
 *
 * `onPublish` is the composer's own existing handleSubmit — passed
 * straight through, never duplicated; this component has no publish/RPC
 * logic of its own.
 */
export default function DispatchPreview({
  authorId,
  authorPseudonym,
  authorMarkUrl,
  title,
  body,
  topics,
  moments,
  postcardDraft,
  postcardCatalogEntry,
  onBack,
  onPublish,
  publishing,
  publishBlockedReason,
  onEditPostcard,
  error,
  identity,
}: {
  /** Official/Sponsored Dispatches — previews the PUBLIC identity (Tempa
   * emblem, or Sponsored + sponsor) instead of the admin's own Mark. */
  identity?: DispatchIdentity
  authorId: string
  authorPseudonym: string
  authorMarkUrl?: string | null
  title: string
  body: string
  topics: string[]
  moments: DispatchMoment[]
  /** The whole Dispatch's one optional Postcard draft, entirely separate
   * from `moments` — same shape/reasoning as LetterPreview's own
   * `postcard` prop. Rendered through LetterheadPostcard, the SAME
   * canonical enclosure slot both Dispatch readers use. null when no
   * Postcard is attached. */
  postcardDraft: LetterPostcardDraft | null
  /** The live, active DB catalogue entry matching postcardDraft.postcardKey
   * — resolved by the caller (dispatch-composer.tsx) from
   * lib/postcards.ts's getActivePostcards. Null (with a non-null
   * postcardDraft) means the key is no longer active — the Postcard slot
   * simply doesn't render rather than showing stale/fabricated content. */
  postcardCatalogEntry: PostcardCatalogEntry | null
  onBack: () => void
  onPublish: () => void
  publishing: boolean
  /** Non-null when a precondition for publishing isn't met yet
   * (currently: an attached Postcard with a blank author-written back).
   * Disables Publish and shows this exact restrained, muted instruction
   * instead of a hard error — deliberately NOT `error` styling: this
   * isn't a failure, it's guidance toward a state the author can
   * immediately fix, same as LetterPreview's own sendBlockedReason. */
  publishBlockedReason?: string | null
  /** Reopens the SAME PostcardEditor the composer already owns (passed
   * straight through, never a second implementation) — PostcardEditor
   * renders above this component's own overlay, so opening it simply
   * stacks on top; closing it naturally reveals this same Preview again,
   * unchanged. Forwarded to LetterheadPostcard as `onEditRequest` and
   * used by the blocked-Publish control's "Write on postcard" link. */
  onEditPostcard?: () => void
  error?: string | null
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onBack])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 sm:px-6">
        <p className={sectionLabelClass}>Preview</p>
        <button type="button" onClick={onBack} aria-label="Close preview" className={helperTextClass}>
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-xl space-y-4">
          {identity && identity.kind !== 'member' ? (
            <DispatchIdentityLabel identity={identity} size="md" linkable={false} />
          ) : (
            <div className="flex items-center gap-3">
              <ProfileIdentityMark
                identifier={authorId}
                markUrl={authorMarkUrl ?? null}
                label={authorMarkUrl ? `${authorPseudonym}'s Mark` : undefined}
                size="md"
              />
              <p className="text-[15px] font-medium text-foreground">{authorPseudonym}</p>
            </div>
          )}

          <h1 className={sectionTitleClass}>{title}</h1>

          {topics.length > 0 && <TopicChips topics={topics} />}

          {postcardDraft && postcardCatalogEntry && (
            <LetterheadPostcard
              base={postcardEntryToBaseContent(postcardCatalogEntry)}
              revealLine={postcardDraft.revealLine}
              backMessage={postcardDraft.backMessage}
              senderPseudonym={authorPseudonym}
              onEditRequest={onEditPostcard}
            />
          )}

          <div className="rounded-md bg-surface-shell p-4 sm:p-6">
            <DispatchBody body={body} moments={moments} />
          </div>
        </div>
      </div>

      <div className="border-t border-foreground/10 px-4 py-4 sm:px-6">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {!error && publishBlockedReason && (
          <div className="mb-3 space-y-1">
            <p className={helperTextClass}>{publishBlockedReason}</p>
            {onEditPostcard && (
              <button type="button" onClick={onEditPostcard} className={`${helperTextClass} underline`}>
                Write on postcard
              </button>
            )}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-xl gap-3">
          <button type="button" onClick={onBack} className={secondaryButtonClass}>
            Back to editing
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing || Boolean(publishBlockedReason)}
            className={primaryButtonClass}
          >
            {/* Same restrained motion-only loading treatment as
                LetterPreview's own Send button — a plain pulse on the
                label, never a spinner/progress bar. */}
            <span className={publishing ? 'animate-pulse' : undefined}>
              {publishing ? 'Publishing…' : 'Publish Dispatch'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

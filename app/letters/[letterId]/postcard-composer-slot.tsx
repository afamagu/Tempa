'use client'

import { POSTCARD_CATALOG, type LetterPostcardDraft } from '@/lib/moments'
import { helperTextClass } from '@/app/profile/ui'
import PostcardThumbnail from '@/app/letters/postcard-thumbnail'

/**
 * Letter-level Postcards V1 (2026-09-13) — the composer's own letterhead
 * slot, the same logical position a delivered letter's Postcard will
 * occupy (see app/letters/letterhead-postcard.tsx). Deliberately NOT a
 * giant upload drop-zone: the empty state is one small, restrained
 * button, matching the composer's other quiet affordances (the ⊕) rather
 * than competing for attention with the writing surface. The Postcard
 * itself is never inserted into ProseMirror — this sits above
 * `<EditorContent>` in moments-composer.tsx, entirely outside the
 * document tree.
 *
 * Thumbnail + expanded-experience checkpoint (2026-09-14) — the filled
 * state now reuses the SAME compact, portrait, still-only
 * PostcardThumbnail the delivered/Preview letterhead slot uses (Part 7:
 * "The composer may also use the compact letterhead thumbnail as its
 * resting state"), so the resting Postcard looks and sizes identically
 * everywhere a member sees it. Tapping it opens PostcardEditor, never
 * the read-only expanded experience — editing vs. reading are still two
 * separate surfaces, only the CLOSED thumbnail treatment is shared.
 */
export default function PostcardComposerSlot({
  draft,
  disabled,
  onAdd,
  onEdit,
}: {
  draft: LetterPostcardDraft | null
  /** True while Postcards aren't currently offerable at all (mirrors the
   * ⊕ affordance's own `enabled` gate) — the empty-state button simply
   * doesn't render rather than opening onto a dead end. A Postcard
   * that's already attached always stays visible/editable regardless. */
  disabled?: boolean
  onAdd: () => void
  onEdit: () => void
}) {
  if (!draft) {
    if (disabled) return null
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 px-3 py-1.5 text-[13px] font-medium text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <span aria-hidden="true">+</span> Add a postcard
        </button>
      </div>
    )
  }

  const postcard = POSTCARD_CATALOG[draft.postcardKey]

  if (!postcard) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit this postcard"
          className={`rounded-md border border-foreground/15 p-3 text-center ${helperTextClass}`}
        >
          Postcard
        </button>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <PostcardThumbnail frontImagePath={postcard.frontImagePath} onOpen={onEdit} ariaLabel="Edit this postcard" />
    </div>
  )
}

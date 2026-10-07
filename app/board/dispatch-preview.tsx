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
import { WEB_PUBLIC_COPY } from '@/lib/public-dispatches'
import DispatchIdentityLabel from './dispatch-identity-label'
import TopicChips from './topic-chips'
import DispatchBody from './dispatch-body'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import type { DispatchMoment } from '@/lib/dispatches'
import type { LetterPostcardDraft } from '@/lib/moments'
import { postcardEntryToBaseContent, type PostcardCatalogEntry } from '@/lib/postcards'

/** Full reading-state preview before a Dispatch is published. It reuses
 * the production reader components and makes no data access of its own.
 * `webPublic`, when supplied, repeats the author's selected web audience
 * immediately beside the final Publish action so the consequence is
 * visible twice: at the control itself and at commitment. */
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
  writingStyleId = null,
  webPublic,
}: {
  identity?: DispatchIdentity
  authorId: string
  authorPseudonym: string
  authorMarkUrl?: string | null
  title: string
  body: string
  topics: string[]
  moments: DispatchMoment[]
  postcardDraft: LetterPostcardDraft | null
  postcardCatalogEntry: PostcardCatalogEntry | null
  onBack: () => void
  onPublish: () => void
  publishing: boolean
  publishBlockedReason?: string | null
  onEditPostcard?: () => void
  error?: string | null
  /** The author's current Writing Style — what a member Dispatch is
   * snapshotted with at Publish. Null for official/sponsored. */
  writingStyleId?: string | null
  /** undefined = the web-visibility feature is unavailable/not offered. */
  webPublic?: boolean
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
    <div className="safe-fixed-screen fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 sm:px-6">
        <p className={sectionLabelClass}>Preview</p>
        <button type="button" onClick={onBack} aria-label="Close preview" className={`${helperTextClass} inline-flex min-h-11 items-center px-2 sm:min-h-0`}>
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
            <DispatchBody body={body} moments={moments} writingStyleId={writingStyleId} />
          </div>
        </div>
      </div>

      <div className="border-t border-foreground/10 px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-xl">
          {webPublic !== undefined && (
            <div className="mb-3 rounded-md border border-foreground/10 px-3 py-2.5">
              <p className="text-[14px] font-medium text-foreground">
                {webPublic ? WEB_PUBLIC_COPY.label : 'Tempa only'}
              </p>
              <p className={helperTextClass}>{webPublic ? WEB_PUBLIC_COPY.previewOn : WEB_PUBLIC_COPY.previewOff}</p>
            </div>
          )}

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
          <div className="flex gap-3">
            <button type="button" onClick={onBack} className={secondaryButtonClass}>
              Back to editing
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing || Boolean(publishBlockedReason)}
              className={primaryButtonClass}
            >
              <span className={publishing ? 'animate-pulse' : undefined}>
                {publishing ? 'Publishing…' : 'Publish Dispatch'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

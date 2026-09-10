'use client'

import { useState } from 'react'
import { proseBodyClass } from '@/app/profile/ui'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import FormattedText from '@/app/letters/formatted-text'
import PhotoMomentToken from '@/app/letters/[letterId]/photo-moment-token'
import PhotoMomentViewer from '@/app/letters/[letterId]/photo-moment-viewer'
import type { DispatchMoment } from '@/lib/dispatches'

/**
 * Renders a Dispatch's paragraphs with any still-image Moments placed
 * exactly where the writer put them — the reading counterpart to
 * LetterBody (app/letters/[letterId]/letter-body.tsx), reusing the same
 * inline-token/full-screen-viewer components, minus everything specific
 * to a private correspondence (no photo-consent lock state — a
 * Dispatch's Moments are either visible because it's published, or not
 * fetched at all; there is no "locked, awaiting a decision" state
 * here). No Postcards — see the Build Guide's Dispatches section.
 */
export default function DispatchBody({
  body,
  moments,
  paragraphAttrs,
}: {
  body: string
  moments: DispatchMoment[]
  /** Optional per-paragraph DOM attributes (e.g. `data-paragraph-index`
   * for the reader's reading-position tracker, see dispatch-reader.tsx)
   * — kept optional so a caller with no need for it (e.g. the profile-
   * integration excerpt, if it ever grows to use this component) isn't
   * forced to supply a no-op. */
  paragraphAttrs?: (index: number) => Record<string, string | number>
}) {
  const [openPhoto, setOpenPhoto] = useState<{ src: string; alt: string; momentId: string } | null>(null)

  const { isRich, body: cleanBody } = stripRichBodyMarker(body)
  const paragraphs = splitParagraphs(cleanBody)
  const momentByPosition = new Map(moments.map((m) => [m.position, m]))

  // Live-test diagnosis (2026-09-10), stage 7: proves whether a Moment
  // that DID reach this component (with a resolved imageUrl) actually
  // lines up with a real paragraph index — the one thing stages 1-6
  // (lib/dispatches.ts's getSharedDispatch) can't see, since paragraph
  // splitting happens here, client-side. Dev-only; never logs paragraph
  // TEXT, only structural counts/positions/booleans. Runs in the
  // browser console (this is a 'use client' component), stripped out of
  // production builds by the NODE_ENV check.
  if (process.env.NODE_ENV !== 'production' && moments.length > 0) {
    console.log('[DispatchBody] stage 7 — paragraph/Moment alignment:', {
      paragraphCount: paragraphs.length,
      momentPositions: moments.map((m) => ({ position: m.position, hasImageUrl: Boolean(m.imageUrl) })),
      matchedAtRender: moments.map((m) => ({
        position: m.position,
        withinParagraphRange: m.position >= 0 && m.position < paragraphs.length,
      })),
    })
  }

  return (
    <>
      <div className="space-y-4">
        {paragraphs.map((paragraph, index) => {
          const moment = momentByPosition.get(index)
          return (
            <p key={index} className={`whitespace-pre-wrap ${proseBodyClass}`} {...(paragraphAttrs?.(index) ?? {})}>
              <FormattedText text={paragraph} isRich={isRich} />
              {moment?.imageUrl && (
                <PhotoMomentToken
                  src={moment.imageUrl}
                  onOpen={() =>
                    setOpenPhoto({
                      src: moment.imageUrl as string,
                      alt: 'A photo shared in this Dispatch',
                      momentId: moment.id,
                    })
                  }
                />
              )}
            </p>
          )
        })}
      </div>

      {openPhoto && (
        <PhotoMomentViewer
          src={openPhoto.src}
          alt={openPhoto.alt}
          momentId={openPhoto.momentId}
          onClose={() => setOpenPhoto(null)}
        />
      )}
    </>
  )
}

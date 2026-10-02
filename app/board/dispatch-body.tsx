'use client'

import { useState } from 'react'
import { splitParagraphs } from '@/lib/moments'
import { groupDispatchMoments } from '@/lib/dispatch-moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import FormattedText from '@/app/letters/formatted-text'
import PhotoMomentToken from '@/app/letters/[letterId]/photo-moment-token'
import PhotoMomentViewer from '@/app/letters/[letterId]/photo-moment-viewer'
import type { DispatchMoment } from '@/lib/dispatches'
import AuthoredProse from '@/app/authored-prose'
import ReadingModeControl, { useReadingMode } from '@/app/reading-mode-control'
import { composeProse, offersReaderView } from '@/lib/writing-style'

/**
 * Renders a Dispatch's paragraphs with any still-image Moments placed
 * exactly where the writer put them — the reading counterpart to
 * LetterBody (app/letters/[letterId]/letter-body.tsx), reusing the same
 * inline-token/full-screen-viewer components, minus everything specific
 * to a private correspondence (no photo-consent lock state — a
 * Dispatch's Moments are either visible because it's published, or not
 * fetched at all; there is no "locked, awaiting a decision" state
 * here). Still no Postcards here — a Dispatch's optional Postcard
 * (Checkpoint 2) is a letterhead-position enclosure rendered by the
 * caller (app/board/[dispatchId]/page.tsx, shared-dispatch-view.tsx) via
 * LetterheadPostcard, never inline prose inside this component, exactly
 * mirroring how a Photo Moment is inline here but a letter-level
 * Postcard never is in LetterBody either.
 */
export default function DispatchBody({
  body,
  moments,
  paragraphAttrs,
  writingStyleId = null,
}: {
  body: string
  moments: DispatchMoment[]
  /** Optional per-paragraph DOM attributes (e.g. `data-paragraph-index`
   * for the reader's reading-position tracker, see dispatch-reader.tsx)
   * — kept optional so a caller with no need for it (e.g. the profile-
   * integration excerpt, if it ever grows to use this component) isn't
   * forced to supply a no-op. */
  paragraphAttrs?: (index: number) => Record<string, string | number>
  /** The style this Dispatch was PUBLISHED in (dispatches.
   * author_writing_style_id) — or, in the composer's Preview, the
   * author's current style. Null = Tempa's classic prose. */
  writingStyleId?: string | null
}) {
  const [openPhoto, setOpenPhoto] = useState<{ src: string; alt: string; momentId: string } | null>(null)
  const [readingMode, setReadingMode] = useReadingMode()

  const { isRich, body: cleanBody } = stripRichBodyMarker(body)
  const paragraphs = splitParagraphs(cleanBody)
  const momentsByPosition = groupDispatchMoments(moments)
  // Writing Style — presentation-only roles (see lib/writing-style.ts).
  const { roles } = composeProse(paragraphs, isRich)
  const readerViewOffered = offersReaderView(writingStyleId, cleanBody)
  const mode = readerViewOffered ? readingMode : 'original'

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
      {readerViewOffered && (
        <div className="mb-2 flex justify-end">
          <ReadingModeControl mode={mode} onChange={setReadingMode} />
        </div>
      )}
      <AuthoredProse styleId={writingStyleId} mode={mode} opening measure>
        {paragraphs.map((paragraph, index) => {
          const passageMoments = momentsByPosition.get(index) ?? []
          return (
            <p
              key={index}
              className={`wp-block whitespace-pre-wrap${roles[index] === 'opening' ? ' wp-opening' : ''}`}
              data-wp-role={roles[index]}
              {...(paragraphAttrs?.(index) ?? {})}
            >
              <FormattedText text={paragraph} isRich={isRich} />
              {passageMoments.filter(moment => moment.imageUrl).map(moment => (
                <span key={moment.id} className="wp-interface">
                  <PhotoMomentToken
                    src={moment.imageUrl as string}
                    onOpen={() =>
                      setOpenPhoto({
                        src: moment.imageUrl as string,
                        alt: 'A photo shared in this Dispatch',
                        momentId: moment.id,
                      })
                    }
                  />
                </span>
              ))}
            </p>
          )
        })}
      </AuthoredProse>

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

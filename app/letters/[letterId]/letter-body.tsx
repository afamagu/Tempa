'use client'

import { useState } from 'react'
import { proseBodyClass } from '@/app/profile/ui'
import { splitParagraphs, POSTCARD_CATALOG, type Moment } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import type { PhotoConsentStatus } from '@/lib/letters'
import MomentDisplay from '@/app/letters/moment-display'
import FormattedText from '@/app/letters/formatted-text'
import LockedPhotoMoment from './locked-photo-moment'
import PhotoMomentToken from './photo-moment-token'
import PhotoMomentViewer from './photo-moment-viewer'

/**
 * Renders a letter's paragraphs with any Moments placed exactly where
 * the writer put them — the reading counterpart to the composer's ⊕
 * gaps. letters.body itself is untouched; this only interprets it.
 *
 * A visible photo Moment renders as a small inline token at the end of
 * its paragraph — the same philosophy and roughly the same size as the
 * composer's own inline photo token, never a large image block
 * separating two paragraphs. This applies uniformly to every finished-
 * letter rendering path (recipient, sender re-reading their own sent
 * letter, any other place LetterBody is used) and to historical photo
 * Moments exactly the same as new ones, since it's driven purely by the
 * `moments` prop, independent of when the letter was sent. Tapping the
 * token opens the full photo in PhotoMomentViewer, a plain overlay —
 * closing it leaves the letter at the same scroll position, since
 * nothing ever navigated away from it.
 *
 * A Photo Moment whose imageUrl came back null was denied a signed URL
 * server-side (see docs/sql/2026-08-31-first-photo-consent.sql) — that
 * is the actual security boundary; this component never decides who can
 * see an image, it only renders whichever locked/unlocked state the
 * server already resolved.
 */
export default function LetterBody({
  body,
  moments,
  photoConsent,
}: {
  body: string
  moments: Moment[]
  /** Omit entirely for a context with no photo-consent concept (there
   * currently is none, but this keeps the prop honest rather than
   * required-but-usually-irrelevant). */
  photoConsent?: {
    correspondenceId: string
    status: PhotoConsentStatus
    requestedBy: string | null
    resolvedBy: string | null
    userId: string
    otherPseudonym: string
  }
}) {
  const [openPhoto, setOpenPhoto] = useState<{ src: string; alt: string; momentId: string } | null>(null)
  // Stripped ONCE against the whole raw body, before paragraph
  // splitting — the rich-body marker only ever sits at position 0 of
  // the whole value (see stripRichBodyMarker's own doc comment), so
  // checking per-paragraph after splitting would incorrectly treat
  // every paragraph but the first as non-rich.
  const { isRich, body: cleanBody } = stripRichBodyMarker(body)
  const paragraphs = splitParagraphs(cleanBody)
  const momentByPosition = new Map(moments.map((m) => [m.position, m]))

  return (
    <>
      <div className="space-y-4 rounded-md bg-surface-shell p-4 sm:p-5">
        {paragraphs.map((paragraph, index) => {
          const moment = momentByPosition.get(index)
          const photoUrl = moment?.type === 'photo' ? moment.imageUrl : null

          return (
            <div key={index}>
              <p className={`whitespace-pre-wrap ${proseBodyClass}`}>
                <FormattedText text={paragraph} isRich={isRich} />
                {moment?.type === 'photo' && photoUrl && (
                  <PhotoMomentToken
                    src={photoUrl}
                    onOpen={() =>
                      setOpenPhoto({ src: photoUrl, alt: 'A photo shared in this letter', momentId: moment.id })
                    }
                  />
                )}
              </p>
              {moment?.type === 'photo' &&
                !photoUrl &&
                photoConsent && (
                  <LockedPhotoMoment
                    id={`locked-photo-${moment.id}`}
                    correspondenceId={photoConsent.correspondenceId}
                    status={photoConsent.status}
                    requestedBy={photoConsent.requestedBy}
                    resolvedBy={photoConsent.resolvedBy}
                    userId={photoConsent.userId}
                    otherPseudonym={photoConsent.otherPseudonym}
                  />
                )}
              {moment?.type === 'postcard' && moment.postcardKey && POSTCARD_CATALOG[moment.postcardKey] && (
                <MomentDisplay type="postcard" postcard={POSTCARD_CATALOG[moment.postcardKey]} />
              )}
            </div>
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

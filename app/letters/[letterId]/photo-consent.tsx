import Link from 'next/link'
import { systemBodyClass, compactSecondaryButtonClass } from '@/app/profile/ui'
import { isPhotoDecisionOutstandingForUser, type PhotoConsentStatus } from '@/lib/letters'
import PhotoConsentChoices from './photo-consent-choices'
import TempaNote from '@/app/tempa-note'

/**
 * A quiet, purely informational summary of this correspondence's photo-
 * sharing state — never a prompt, with ONE deliberate exception: the
 * outstanding-decision case below (pending's non-requester, or
 * deferred's resolver — see isPhotoDecisionOutstandingForUser), which is
 * the person who actually owes a decision and would otherwise have no
 * indication of that anywhere on this page. Every other branch stays
 * informational only.
 *
 * The actual three-way decision (PhotoConsentChoices) is the SAME
 * component locked-photo-moment.tsx uses — never a second
 * implementation. Normally this banner just links to the locked Moment
 * itself ("Review photo"), since that's usually a real, reachable
 * place. But the decision surface must not depend on whether the
 * current viewer can see the triggering photo: whoever reconsiders a
 * photo_free choice was, by definition, the non-sender of the original
 * photo, so reconsideration always flips "who owes the decision" to
 * that photo's own sender — who can always see it (can_view_letter_photo's
 * sender clause is unconditional), so it's never locked for them, so
 * LockedPhotoMoment never mounts anywhere for them. `reviewPhotoHref`
 * being undefined is exactly that signal — no locked-photo surface
 * exists for this viewer — so the choices render directly here instead.
 * The two are mutually exclusive (never both at once): a link when one
 * exists, the live controls only when it doesn't.
 *
 * Visual Language Pass 1B: every purely passive/no-action branch below
 * (pending-waiting, deferred-waiting, photo_free-not-resolver, and the
 * plain "enabled" state) now renders through the shared TempaNote
 * primitive (app/tempa-note.tsx). The outstanding-decision branch above
 * is deliberately NOT converted — it carries a real action (a link or
 * live decision controls), which TempaNote does not support.
 */
export default function PhotoConsent({
  correspondenceId,
  status,
  requestedBy,
  resolvedBy,
  userId,
  otherPseudonym,
  reviewPhotoHref,
}: {
  correspondenceId: string
  status: PhotoConsentStatus
  requestedBy: string | null
  resolvedBy: string | null
  userId: string
  otherPseudonym: string
  /** Href to the first still-locked Photo Moment this viewer owes a
   * decision on (see page.tsx) — undefined when no locked instance
   * exists for this viewer (e.g. they're the original photo's sender),
   * in which case the live decision controls render here instead. */
  reviewPhotoHref?: string
}) {
  if (status === 'no_request') return null

  if (isPhotoDecisionOutstandingForUser({ status, requestedBy, resolvedBy }, userId)) {
    return (
      <div className="space-y-2 rounded-md border border-foreground/10 px-4 py-3">
        <p className="text-[14px] font-semibold text-foreground">
          A photo is waiting for your decision.
        </p>
        <p className={systemBodyClass}>
          {otherPseudonym} included a photo with this letter. You choose whether photo sharing
          becomes part of this correspondence.
        </p>
        {reviewPhotoHref ? (
          <Link href={reviewPhotoHref} className={compactSecondaryButtonClass}>
            Review photo
          </Link>
        ) : (
          <PhotoConsentChoices correspondenceId={correspondenceId} showMaybeLater={status === 'pending'} />
        )}
      </div>
    )
  }

  const isRequester = requestedBy === userId

  if (status === 'pending') {
    // The outstanding branch above already covers the non-requester;
    // this is only ever reached by the requester, still waiting.
    return isRequester ? (
      <TempaNote>Photo sharing is still waiting for their decision.</TempaNote>
    ) : null
  }

  if (status === 'deferred') {
    // The outstanding branch above already covers the resolver (the
    // person who deferred); this is only ever reached by the requester.
    return isRequester ? <TempaNote>They&apos;d prefer to wait before exchanging photos.</TempaNote> : null
  }

  if (status === 'photo_free') {
    // Resolved, not outstanding — deliberately never routed through the
    // branch above. The resolver's own reconsideration option lives at
    // the locked photo itself (locked-photo-moment.tsx) and is not
    // duplicated here. Gated on resolvedBy (who actually made this
    // choice), not requestedBy — the two are different people, and using
    // the wrong one here previously meant this branch never correctly
    // identified the resolver.
    const isResolver = resolvedBy === userId
    return isResolver ? null : (
      <TempaNote>They&apos;d prefer to keep this correspondence photo-free.</TempaNote>
    )
  }

  return <TempaNote>Moments are enabled in this correspondence.</TempaNote>
}

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PhotoConsent from './photo-consent'

// PhotoConsentChoices (rendered by the outstanding branch below) calls
// useRouter/createClient — mocked here purely so the component can
// render; neither is actually invoked during a static render pass
// (no click ever fires), so these never need to do anything.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ error: null }) }) }))

// The exact live scenario: A (Melons) sent the triggering photo. B
// (Saint Nicole) chose photo_free, then later reconsidered — which
// makes B the new requested_by and resets resolved_by to null. A
// therefore owes the decision, but A is also the original photo's
// sender, so A can already see it and has no LockedPhotoMoment
// anywhere in the thread — reviewPhotoHref comes back undefined.
const MELONS = 'user-melons'
const SAINT_NICOLE = 'user-saint-nicole'

describe('PhotoConsent — reconsideration scenario (Melons / Saint Nicole)', () => {
  it('non-requester with no reviewPhotoHref (sender of the original photo) gets live decision controls, not a dead link', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="pending"
        requestedBy={SAINT_NICOLE}
        resolvedBy={null}
        userId={MELONS}
        otherPseudonym="Saint Nicole"
        reviewPhotoHref={undefined}
      />
    )

    expect(html).toContain('A photo is waiting for your decision.')
    expect(html).toContain('View this photo and allow photo sharing')
    expect(html).toContain('Keep this correspondence photo-free')
    // status is 'pending' — Maybe later is a valid first-time choice.
    expect(html).toContain('Maybe later')
    // The dead end this fixes: no link pointing at a locked photo that
    // doesn't exist for this viewer.
    expect(html).not.toContain('Review photo')
    // Visual Language Pass 1B: the outstanding-decision branch (this
    // one — it carries live controls) is NOT rendered through TempaNote.
    expect(html).not.toContain('Tempa Note')
  })

  it('requester (Saint Nicole, mid-reconsideration) only sees the waiting message, never decision controls', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="pending"
        requestedBy={SAINT_NICOLE}
        resolvedBy={null}
        userId={SAINT_NICOLE}
        otherPseudonym="Melons"
        reviewPhotoHref={undefined}
      />
    )

    expect(html).toContain('Photo sharing is still waiting for their decision.')
    expect(html).not.toContain('View this photo and allow photo sharing')
    expect(html).not.toContain('Keep this correspondence photo-free')
    expect(html).not.toContain('Maybe later')
    // Visual Language Pass 1B: this is the passive "still waiting"
    // report — it now renders through the shared TempaNote primitive.
    expect(html).toContain('Tempa Note')
    expect(html).toMatch(/border-clay/)
  })

  it('non-requester WITH a genuinely locked photo gets the link, never duplicate inline controls at the same time', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="pending"
        requestedBy={SAINT_NICOLE}
        resolvedBy={null}
        userId={MELONS}
        otherPseudonym="Saint Nicole"
        reviewPhotoHref="/letters/letter-1#locked-photo-m1"
      />
    )

    expect(html).toContain('Review photo')
    // The link and the live choices are mutually exclusive — never both
    // rendered for the same viewer at the same time.
    expect(html).not.toContain('View this photo and allow photo sharing')
    expect(html).not.toContain('Keep this correspondence photo-free')
  })

  it('deferred resolver with no reviewPhotoHref also gets live controls, without Maybe later (already deferred once)', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="deferred"
        requestedBy={SAINT_NICOLE}
        resolvedBy={MELONS}
        userId={MELONS}
        otherPseudonym="Saint Nicole"
        reviewPhotoHref={undefined}
      />
    )

    expect(html).toContain('View this photo and allow photo sharing')
    expect(html).toContain('Keep this correspondence photo-free')
    // respond_photo_sharing rejects 'defer' once already deferred.
    expect(html).not.toContain('Maybe later')
    expect(html).not.toContain('Tempa Note')
  })
})

// Visual Language Pass 1B — the remaining passive/no-action branches
// (not covered by the reconsideration scenario above), each rendered
// through the shared TempaNote primitive.
describe('PhotoConsent — passive branches render through TempaNote', () => {
  it('photo_free, non-resolver: reports the settled state via TempaNote', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="photo_free"
        requestedBy={MELONS}
        resolvedBy={SAINT_NICOLE}
        userId={MELONS}
        otherPseudonym="Saint Nicole"
        reviewPhotoHref={undefined}
      />
    )
    expect(html).toContain('prefer to keep this correspondence photo-free.')
    expect(html).toContain('Tempa Note')
    expect(html).toMatch(/border-clay/)
  })

  it('photo_free, the resolver themselves: renders nothing at all', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="photo_free"
        requestedBy={MELONS}
        resolvedBy={SAINT_NICOLE}
        userId={SAINT_NICOLE}
        otherPseudonym="Melons"
        reviewPhotoHref={undefined}
      />
    )
    expect(html).toBe('')
  })

  it('enabled status (photos enabled): reports the settled state via TempaNote', () => {
    const html = renderToStaticMarkup(
      <PhotoConsent
        correspondenceId="corr-1"
        status="enabled"
        requestedBy={MELONS}
        resolvedBy={MELONS}
        userId={SAINT_NICOLE}
        otherPseudonym="Melons"
        reviewPhotoHref={undefined}
      />
    )
    expect(html).toContain('Photos are enabled in this correspondence.')
    expect(html).toContain('Tempa Note')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PhotoConsentChoices from './photo-consent-choices'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ error: null }) }) }))

/**
 * The ONE implementation of the three-choice decision — used both by
 * LockedPhotoMoment (the normal case: a genuinely locked photo) and by
 * PhotoConsent (the reconsideration case: no locked photo exists for
 * this viewer). Testing it directly here is what confirms "the normal
 * locked-photo decision surface still works" without needing to
 * simulate LockedPhotoMoment's own tap-to-expand interaction.
 */
describe('PhotoConsentChoices', () => {
  it('shows all three choices, including Maybe later, for a first-time pending decision', () => {
    const html = renderToStaticMarkup(<PhotoConsentChoices correspondenceId="corr-1" showMaybeLater />)
    expect(html).toContain('View this photo and allow photo sharing')
    expect(html).toContain('Maybe later')
    expect(html).toContain('Keep this correspondence photo-free')
  })

  it('omits Maybe later once already deferred — matches respond_photo_sharing rejecting a second defer', () => {
    const html = renderToStaticMarkup(<PhotoConsentChoices correspondenceId="corr-1" showMaybeLater={false} />)
    expect(html).toContain('View this photo and allow photo sharing')
    expect(html).not.toContain('Maybe later')
    expect(html).toContain('Keep this correspondence photo-free')
  })
})

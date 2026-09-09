import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MomentsAvailableNotice from './moments-available-notice'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/acknowledgements', () => ({ acknowledgeCorrespondenceFeature: () => Promise.resolve({ error: null }) }))

// B. The Moments-available notice no longer contains Postcard language —
// MOMENTS = PHOTOGRAPHS now. Its one-time/acknowledgement-write behavior
// (see the component's own doc comment) is untouched by this checkpoint;
// only the copy changed.
describe('MomentsAvailableNotice — no Postcard language (Moments = photographs)', () => {
  it('never mentions "postcard"', () => {
    const html = renderToStaticMarkup(
      <MomentsAvailableNotice
        correspondenceId="corr-1"
        otherPseudonym="Evening Quill"
        composeHref="/letters/with/other-1/write"
      />
    )
    expect(html.toLowerCase()).not.toContain('postcard')
  })

  it('says Moments, not Postcards and Photos, are now available', () => {
    const html = renderToStaticMarkup(
      <MomentsAvailableNotice
        correspondenceId="corr-1"
        otherPseudonym="Evening Quill"
        composeHref="/letters/with/other-1/write"
      />
    )
    expect(html).toContain('You can now add Moments')
    expect(html).toContain('Evening Quill')
  })

  it('still links to the compose href with the same "Continue writing" action', () => {
    const html = renderToStaticMarkup(
      <MomentsAvailableNotice
        correspondenceId="corr-1"
        otherPseudonym="Evening Quill"
        composeHref="/letters/with/other-1/write"
      />
    )
    expect(html).toContain('href="/letters/with/other-1/write"')
    expect(html).toContain('Continue writing')
  })
})

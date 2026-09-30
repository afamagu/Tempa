import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import UnavailableState from './unavailable-state'
import NotFound from './not-found'
import ProfileNotFound from './minds/[userId]/not-found'
import DispatchNotFound from './board/[dispatchId]/not-found'

function normalize(html: string) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
}

describe('Tempa unavailable states', () => {
  it('renders a branded global not-found state instead of the framework blank page', () => {
    const html = normalize(renderToStaticMarkup(<NotFound />))
    expect(html).toContain('Tempa')
    expect(html).toContain('Nothing here.')
    expect(html).toContain('Return to Tempa')
    expect(html).not.toContain('This page could not be found')
  })

  it('keeps a missing profile deliberately neutral', () => {
    const html = normalize(renderToStaticMarkup(<ProfileNotFound />))
    expect(html).toContain('This profile is no longer available.')
    expect(html).toContain('Back to People')
    expect(html.toLowerCase()).not.toContain('deleted')
    expect(html.toLowerCase()).not.toContain('banned')
    expect(html.toLowerCase()).not.toContain('suspended')
  })

  it('keeps an unavailable Dispatch neutral as well', () => {
    const html = normalize(renderToStaticMarkup(<DispatchNotFound />))
    expect(html).toContain('This Dispatch is no longer available.')
    expect(html).toContain('Back to The Board')
    expect(html.toLowerCase()).not.toContain('deleted account')
    expect(html.toLowerCase()).not.toContain('banned')
  })

  it('supports route-specific recovery actions through one shared component', () => {
    const html = normalize(
      renderToStaticMarkup(
        <UnavailableState
          title="Unavailable"
          description="This content cannot be opened."
          actionHref="/letters"
          actionLabel="Back to Letterbox"
        />
      )
    )
    expect(html).toContain('href="/letters"')
    expect(html).toContain('Back to Letterbox')
  })
})

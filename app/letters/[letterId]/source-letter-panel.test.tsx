import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SourceLetterPanel from './source-letter-panel'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))

const baseProps = {
  onClose: () => {},
  pseudonym: 'Cupcake',
  viewerId: 'viewer-1',
  letterId: 'letter-1',
  body: 'Dear friend,\n\nHope this finds you well.',
  moments: [],
}

describe('SourceLetterPanel — the "View [pseudonym]\'s letter" reference overlay', () => {
  it('renders nothing at all when closed', () => {
    const html = renderToStaticMarkup(<SourceLetterPanel open={false} {...baseProps} />)
    expect(html).toBe('')
  })

  it('opens as a dialog labeled with the specific pseudonym, with a clear × close control, when open', () => {
    const html = renderToStaticMarkup(<SourceLetterPanel open {...baseProps} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain(`aria-label="${baseProps.pseudonym}&#x27;s letter"`)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('×')
  })

  it('renders the actual source letter body content, via the same reading surface as the normal reader', () => {
    const html = renderToStaticMarkup(<SourceLetterPanel open {...baseProps} />)
    expect(html).toContain('Dear friend')
    expect(html).toContain('Hope this finds you well')
  })

  it('is a near-full-height sheet on mobile and a centered, max-height-bounded dialog on desktop (sm: overrides)', () => {
    const html = renderToStaticMarkup(<SourceLetterPanel open {...baseProps} />)
    expect(html).toContain('sm:h-auto')
    expect(html).toContain('sm:max-h-[85vh]')
    expect(html).toContain('sm:items-center')
    expect(html).toContain('sm:justify-center')
  })
})

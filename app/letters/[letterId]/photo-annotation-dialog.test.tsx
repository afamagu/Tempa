import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PhotoAnnotationDialog from './photo-annotation-dialog'

describe('PhotoMoment annotation overlay', () => {
  it('provides accessible finger/mouse marking, undo, clear, cancel and unchanged-photo flow', () => {
    const html = renderToStaticMarkup(
      <PhotoAnnotationDialog image={new Blob(['image'], { type: 'image/jpeg' })} onApply={vi.fn()} onCancel={vi.fn()} />
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Mark your photo"')
    expect(html).toContain('Photo annotation drawing surface')
    expect(html).toContain('Undo mark')
    expect(html).toContain('Clear marks')
    expect(html).toContain('Include photo')
    expect(html).toContain('without making marks')
    expect(html).toContain('touch-none')
  })
})

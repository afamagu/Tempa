import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'photo-moment-viewer.tsx'), 'utf8')

describe('PhotoMomentViewer — mobile Back behavior', () => {
  it('adds a transient history entry and listens for popstate', () => {
    expect(source).toContain('window.history.pushState')
    expect(source).toContain("window.addEventListener('popstate'")
    expect(source).toContain('tempaPhotoMoment')
  })

  it('routes explicit close through history.back when the overlay owns the current entry', () => {
    expect(source).toContain('window.history.back()')
    expect(source).toContain('onClick={requestClose}')
  })

  it('keeps Escape as a close affordance without bypassing the history cleanup', () => {
    expect(source).toContain("if (e.key === 'Escape') requestClose()")
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const control = readFileSync(path.join(__dirname, 'correspondence-rhythm-control.tsx'), 'utf8')

describe('Letterbox correspondence rhythm', () => {
  it('looks up only an active established correspondence for rhythm', () => {
    expect(page).toContain('getActiveEstablishedCorrespondenceWithUser')
    expect(page).toContain('isEstablishedForViewer')
    expect(page).toContain('activeCorrespondence && establishedForViewer && correspondenceRhythm')
  })

  it('does not infer rhythm for historical-only archives', () => {
    expect(page).toContain('activeCorrespondence ?')
    expect(page).toContain(': false')
    expect(page).toContain('activeCorrespondence && establishedForViewer')
  })

  it('uses the participant-only correspondence rhythm RPC helper', () => {
    expect(page).toContain('getCorrespondenceRhythm(supabase, activeCorrespondence.id)')
    expect(page).toContain('getMyWritingRhythm(supabase)')
  })

  it('lets the viewer return to their usual rhythm instead of trapping an override', () => {
    expect(control).toContain("selected === 'default' ? null : selected")
    expect(control).toContain('Use my usual rhythm')
  })

  it('does not frame rhythm as a deadline or score', () => {
    expect(control).toContain('It is not a deadline.')
    expect(control.toLowerCase()).not.toContain('reply score')
    expect(control.toLowerCase()).not.toContain('late')
  })

  it('uses Letterbox terminology rather than the retired Pen pals back label', () => {
    expect(page).toContain('aria-label="Back to Letterbox"')
    expect(page).not.toContain('aria-label="Back to Pen pals"')
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Choose Your Mark prototype — corrected family comparison', () => {
  it('presents exactly V2, WEAVE, CONTOUR, and GLYPH as the four candidate columns', () => {
    for (const label of ['V2', 'WEAVE', 'CONTOUR', 'GLYPH']) {
      expect(source).toContain(`<MarkColumn label="${label}"`)
    }
    expect((source.match(/<MarkColumn label=/g) ?? [])).toHaveLength(4)
    for (const retired of ['V3" mark=', 'V4 CUT', 'V5 WASH', 'V5 GLASS']) expect(source).not.toContain(retired)
  })

  it('runs V2 and all three new families against the same selected file', () => {
    expect(source).toContain('generateMarkV2(file)')
    expect(source).toContain('generateMarkWeave(file)')
    expect(source).toContain('generateMarkContour(file)')
    expect(source).toContain('generateMarkGlyph(file)')
  })

  it('keeps full, medium, and avatar-scale previews plus structure mode', () => {
    expect(source).toContain('size={160}')
    expect(source).toContain('size={72}')
    expect(source).toContain('size={40}')
    expect(source).toContain('showStructure ? mark.structureDataUrl : mark.dataUrl')
  })
})

describe('Choose Your Mark prototype — source preview URL lifecycle', () => {
  it('tracks each created preview URL in a live ref and revokes that ref on unmount', () => {
    expect(source).toContain('const sourcePreviewUrlsRef = useRef(new Set<string>())')
    expect(source).toContain('sourcePreviewUrlsRef.current.add(sourcePreviewUrl)')
    expect(source).toContain('for (const url of sourcePreviewUrlsRef.current) URL.revokeObjectURL(url)')
    expect(source).toContain('sourcePreviewUrlsRef.current.clear()')
    expect(source).not.toContain('for (const s of samples) URL.revokeObjectURL(s.sourcePreviewUrl)')
  })
})

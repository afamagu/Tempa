import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const layout = readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8')
const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8')

describe('root mobile safe-area contract', () => {
  it('opts the Next.js viewport into edge-to-edge safe-area reporting', () => {
    expect(layout).toContain('viewportFit: "cover"')
  })

  it('keeps ordinary route content clear of top and side display cutouts', () => {
    expect(css).toContain('padding-top: env(safe-area-inset-top)')
    expect(css).toContain('padding-left: env(safe-area-inset-left)')
    expect(css).toContain('padding-right: env(safe-area-inset-right)')
  })
})

import { describe, expect, it } from 'vitest'
import manifest from './manifest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const rootLayout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
const globalCss = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

function pngDimensions(file: string) {
  const bytes = readFileSync(join(process.cwd(), file))
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('PWA baseline — installation and iOS standalone contract', () => {
  it('opens on the canonical origin in standalone mode with a consistent identity', () => {
    const m = manifest()
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.background_color).toBeTruthy()
    expect(m.theme_color).toBe(m.background_color)
  })

  it('offers platform-appropriate standard, maskable and Apple icons', () => {
    const icons = manifest().icons ?? []
    expect(icons.some(icon => icon.src === '/icons/icon-192.png' && icon.purpose === 'any')).toBe(true)
    expect(icons.some(icon => icon.src === '/icons/icon-512.png' && icon.purpose === 'any')).toBe(true)
    expect(icons.some(icon => icon.src === '/icons/icon-maskable-512.png' && icon.purpose === 'maskable')).toBe(true)
    expect(pngDimensions('public/icons/icon-192.png')).toEqual({ width: 192, height: 192 })
    expect(pngDimensions('public/icons/icon-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngDimensions('public/icons/icon-maskable-512.png')).toEqual({ width: 512, height: 512 })
    expect(readFileSync(join(process.cwd(), 'app/apple-icon.png')).length).toBeGreaterThan(100)
    expect(rootLayout).toContain('appleWebApp:')
    expect(rootLayout).toContain('title: SITE_NAME')
  })

  it('retains mobile safe-area and keyboard viewport configuration', () => {
    expect(rootLayout).toContain('viewportFit: "cover"')
    expect(rootLayout).toContain('interactiveWidget: "resizes-content"')
    expect(globalCss).toContain('padding-top: env(safe-area-inset-top)')
    expect(globalCss).toContain('padding-left: env(safe-area-inset-left)')
    expect(globalCss).toContain('padding-right: env(safe-area-inset-right)')
    expect(globalCss).toContain('padding-bottom: env(safe-area-inset-bottom)')
  })
})

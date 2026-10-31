import { describe, expect, it } from 'vitest'
import manifest from './manifest'
import { metadata, viewport } from './layout'

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
    expect(metadata.appleWebApp?.title).toBe(manifest().name)
  })

  it('retains mobile safe-area and keyboard viewport configuration', () => {
    expect(viewport.viewportFit).toBe('cover')
    expect(viewport.interactiveWidget).toBe('resizes-content')
  })
})

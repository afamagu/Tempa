// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildMarketplace, type Marketplace } from '@/lib/marketplace'
import { fixture, NOW } from '@/lib/__tests__/marketplaceFixture'

// Commerce Checkpoint 3 — the picker is the shared catalogue in "pick" mode.
// Its contract with both composers is unchanged: active catalogue in, a
// postcard key out. Commerce data is read once; if it cannot be read the
// picker falls back to the active catalogue (sending never blocked; the
// server ownership check still applies).

const loadMarketplace = vi.fn<(...args: unknown[]) => Promise<Marketplace>>()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/marketplace', async (orig) => ({ ...(await orig<typeof import('@/lib/marketplace')>()), loadMarketplace: (...a: unknown[]) => loadMarketplace(...a) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RAW = fixture()
const POSTCARDS = RAW.postcards
const source = readFileSync(path.join(__dirname, 'postcard-picker.tsx'), 'utf8')

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.resetModules()
  loadMarketplace.mockReset()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function mount(onSelect = vi.fn(), onCancel = vi.fn(), postcards = POSTCARDS) {
  const { default: PostcardPicker } = await import('./postcard-picker')
  await act(async () => root.render(<PostcardPicker postcards={postcards} onSelect={onSelect} onCancel={onCancel} />))
  await act(async () => {})
  return { onSelect, onCancel }
}
const tiles = () => [...container.querySelectorAll('[data-testid="catalogue-tile"]')] as HTMLButtonElement[]
const byText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

describe('PostcardPicker — the shared catalogue in pick mode', () => {
  it('shows a quiet loading grid (no search, no labels) until the catalogue is ready', async () => {
    const { default: PostcardPicker } = await import('./postcard-picker')
    const html = renderToStaticMarkup(<PostcardPicker postcards={POSTCARDS} onSelect={() => {}} onCancel={() => {}} />)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('Search Postcards')
  })

  it('honest empty state when the active catalogue is empty', async () => {
    const { default: PostcardPicker } = await import('./postcard-picker')
    const html = renderToStaticMarkup(<PostcardPicker postcards={[]} onSelect={() => {}} onCancel={() => {}} />)
    expect(html).toContain('No postcards available right now.')
  })

  it('reads the marketplace once with the caller’s active catalogue, then lists compact tiles', async () => {
    loadMarketplace.mockResolvedValue(buildMarketplace(RAW, NOW))
    await mount()
    expect(loadMarketplace).toHaveBeenCalledTimes(1)
    expect(loadMarketplace.mock.calls[0][1]).toBe(POSTCARDS)
    expect(tiles().length).toBe(5)
    expect(container.querySelector('input[aria-label="Search Postcards"]')).toBeTruthy()
    expect(container.textContent).not.toContain('Living')
  })

  it('choosing an allowed Postcard returns its exact catalogue key to the Letter flow', async () => {
    loadMarketplace.mockResolvedValue(buildMarketplace(RAW, NOW))
    const { onSelect } = await mount()
    await act(async () => tiles().find((t) => t.getAttribute('aria-label')!.startsWith('Essaouira'))!.click())
    await act(async () => byText('Use this Postcard')!.click())
    expect(onSelect).toHaveBeenCalledWith('essaouira')
  })

  it('an unowned premium Postcard offers no "Use this Postcard"', async () => {
    loadMarketplace.mockResolvedValue(buildMarketplace(RAW, NOW))
    await mount()
    await act(async () => tiles().find((t) => t.getAttribute('aria-label')!.startsWith('Lanterns'))!.click())
    expect(byText('Use this Postcard')).toBeUndefined()
  })

  it('if commerce data cannot be read, sending is never blocked: the active catalogue stays usable', async () => {
    loadMarketplace.mockRejectedValue(new Error('network'))
    const { onSelect } = await mount()
    expect(tiles().length).toBe(POSTCARDS.length)
    expect(tiles().every((t) => !/Credits|Complimentary|Yours$/.test(t.getAttribute('aria-label')!))).toBe(true)
    await act(async () => tiles().find((t) => t.getAttribute('aria-label')!.startsWith('Lanterns'))!.click())
    await act(async () => byText('Use this Postcard')!.click())
    expect(onSelect).toHaveBeenCalledWith('lanterns')
  })

  it('Close returns to the composer', async () => {
    loadMarketplace.mockResolvedValue(buildMarketplace(RAW, NOW))
    const { onCancel } = await mount()
    await act(async () => (container.querySelector('button[aria-label="Close Postcards"]') as HTMLButtonElement).click())
    expect(onCancel).toHaveBeenCalled()
  })

  it('locks document scrolling while open', () => {
    expect(source).toContain("document.body.style.overflow = 'hidden'")
    expect(source).toContain('document.body.style.overflow = previousOverflow')
  })
})

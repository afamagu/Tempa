// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildMarketplace, type MemberContext } from '@/lib/marketplace'
import { fixture, NOW } from '@/lib/__tests__/marketplaceFixture'
import type { UnlockFn } from './use-unlock'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
const { default: CatalogueBrowser } = await import('./catalogue-browser')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let reduced = false
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  reduced = false
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const market = (context: Partial<MemberContext> = {}, raw = fixture()) =>
  buildMarketplace({ ...raw, context: { ...raw.context, ...context } }, NOW)

async function render(props: Partial<Parameters<typeof CatalogueBrowser>[0]> = {}) {
  await act(async () => root.render(<CatalogueBrowser marketplace={market()} mode="browse" {...props} />))
}

const q = (sel: string) => container.querySelector(sel)
const byText = (text: string, sel = 'button') =>
  [...document.querySelectorAll(sel)].find((el) => el.textContent?.trim() === text) as HTMLElement | undefined
const tiles = () => [...container.querySelectorAll('[data-testid="catalogue-tile"]')] as HTMLButtonElement[]
const tileTitles = () => tiles().map((t) => t.getAttribute('aria-label')!.split(',')[0])
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
async function type(value: string) {
  const input = q('input[type="search"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const openTile = async (title: string) => click(tiles().find((t) => t.getAttribute('aria-label')!.startsWith(title)))

describe('compact grid', () => {
  it('2 columns on mobile, up to 6 on desktop; still thumbnails only, lazy-loaded; no motion in the grid', async () => {
    await render()
    const grid = q('[data-testid="catalogue-grid"]')!
    expect(grid.className).toMatch(/\bgrid-cols-2\b/)
    expect(grid.className).toMatch(/\blg:grid-cols-5\b/)
    expect(grid.className).toMatch(/\bxl:grid-cols-6\b/)
    expect(container.querySelector('video')).toBeNull()
    const imgs = [...grid.querySelectorAll('img')]
    expect(imgs.length).toBe(tiles().length)
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy' && i.getAttribute('decoding') === 'async')).toBe(true)
  })

  it('each tile carries exactly one state, announced to screen readers', async () => {
    await render()
    const label = (title: string) => tiles().find((t) => t.getAttribute('aria-label')!.startsWith(title))!.getAttribute('aria-label')
    expect(label('Essaouira')).toMatch(/Complimentary$/)
    expect(label('Lanterns')).toMatch(/40 Credits$/)
    expect(label('Harbour')).toMatch(/Yours$/)
  })

  it('drafts and premium Postcards without a current price are not listed', async () => {
    await render()
    expect(tileTitles()).not.toContain('New Draft')
    expect(tileTitles()).not.toContain('No Price')
  })

  it('the default view is labelled Featured (“Chosen by Tempa”), never as personalised', async () => {
    await render()
    expect(container.textContent).toContain('Chosen by Tempa')
    expect(container.textContent).not.toMatch(/personali[sz]ed|based on your|For You/i)
    expect(byText('Featured')?.getAttribute('aria-pressed')).toBe('true')
    expect(tileTitles().slice(0, 2)).toEqual(['Lanterns', 'Bangkok'])
  })
})

describe('search and facets', () => {
  it('search matches metadata (aliases, moods, descriptions) and can be cleared', async () => {
    await render()
    await type('monsoon')
    expect(tileTitles()).toEqual(['Bangkok'])
    await type('calm')
    expect(tileTitles().sort()).toEqual(['Essaouira', 'Lanterns'])
    await click(byText('Clear'))
    expect(tileTitles().length).toBe(5)
  })

  it('only non-empty views appear; a facet shows its terms; internal country codes never appear', async () => {
    await render()
    const views = [...container.querySelectorAll('[aria-label="Browse by"] button')].map((b) => b.textContent)
    expect(views).toEqual(['Featured', 'Countries', 'Moods', 'Occasions', 'Complimentary'])
    await click(byText('Countries'))
    const terms = [...container.querySelectorAll('[aria-label="Countries filter"] button')].map((b) => b.textContent)
    expect(terms).toEqual(['All', 'Morocco'])
    expect(container.textContent).not.toMatch(/\bMA\b/)
    await click(byText('Moods'))
    await click(byText('Calm'))
    expect(tileTitles().sort()).toEqual(['Essaouira', 'Lanterns'])
    await click(byText('Complimentary'))
    expect(tileTitles().sort()).toEqual(['Bangkok', 'Essaouira'])
  })
})

describe('tabs, Gifts and Yours', () => {
  it('no Gifts tab when no published Gift exists', async () => {
    await render()
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Postcards', 'Yours'])
  })

  it('a real published Gift adds the Gifts tab', async () => {
    const raw = fixture()
    raw.products = [...raw.products!, { id: 'g1', slug: 'gift-thanks', product_type: 'gift', title: 'Thank you', short_description: null, story_description: null, is_complimentary: false, postcard_key: null, preview_policy: 'still_only' }]
    raw.prices = [...raw.prices, { product_id: 'g1', credit_amount: 10, effective_from: '2026-09-01T00:00:00Z', effective_to: null }]
    raw.giftVersions = [{ product_id: 'g1', title: 'Thank you', image_path: '/g.jpg', thumbnail_path: null }]
    await render({ marketplace: market({}, raw) })
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Postcards', 'Gifts', 'Yours'])
    await click(byText('Gifts'))
    expect(tileTitles()).toEqual(['Thank you'])
  })

  it('Yours separates Postcards you can SEND from Keepsakes you RECEIVED', async () => {
    await render()
    await click(byText('Yours'))
    expect(container.textContent).toContain('Yours to send')
    expect(tileTitles().sort()).toEqual(['Harbour', 'Retired Owned'])
    expect(container.textContent).toContain('Received Keepsakes')
    expect(container.textContent).toContain('Receiving one doesn’t make it yours to send.')
    expect(container.querySelector('a[href="/you/keepsakes/postcards"]')).toBeTruthy()
  })
})

describe('product detail and motion', () => {
  it('opens as a dialog with the real Postcard; motion only after an explicit preview; muted', async () => {
    await render()
    await openTile('Lanterns')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Lanterns')
    expect(dialog.textContent).toContain('A festival of light.')
    expect(document.querySelector('video')).toBeNull()
    await click(byText('Preview motion'))
    const video = document.querySelector('video')!
    expect(video).toBeTruthy()
    expect(video.muted).toBe(true)
  })

  it('still_only / none policies never offer motion', async () => {
    await render()
    await openTile('Harbour')
    expect(byText('Preview motion')).toBeUndefined()
    expect(document.querySelector('video')).toBeNull()
  })

  it('reduced motion: no preview control and no video, even for a controlled preview', async () => {
    reduced = true
    await render()
    await openTile('Essaouira')
    expect(byText('Preview motion')).toBeUndefined()
    expect(document.querySelector('video')).toBeNull()
  })

  it('explains that receiving a premium Postcard does not grant sending; Escape closes and returns focus', async () => {
    await render()
    await openTile('Lanterns')
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('only unlocking it makes it yours to send')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await act(async () => new Promise((r) => requestAnimationFrame(() => r())))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Lanterns/)
  })
})

describe('unlocking', () => {
  it('commerce disabled: price shown, unlock disabled, no call made', async () => {
    const unlock = vi.fn()
    await render({ unlock: unlock as unknown as UnlockFn })
    await openTile('Lanterns')
    const btn = byText('Unlock for 40 Credits') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(document.body.textContent).toContain('Unlocking with Credits isn’t open yet.')
    await click(btn)
    expect(unlock).not.toHaveBeenCalled()
  })

  it('insufficient Credits: shortfall explained, no fake checkout', async () => {
    await render({ marketplace: market({ spendEnabled: true, balance: 25 }) })
    await openTile('Lanterns')
    expect((byText('Unlock for 40 Credits') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('You have 25 Credits — 15 more needed. Getting Credits isn’t available yet.')
  })

  it('confirm → one request even on repeated clicks → owned + balance updated without reload', async () => {
    let resolve: (v: Awaited<ReturnType<UnlockFn>>) => void = () => {}
    const unlock = vi.fn<UnlockFn>(() => new Promise((r) => (resolve = r)))
    await render({ marketplace: market({ spendEnabled: true, balance: 100 }), unlock })
    expect(q('[data-testid="credit-balance"]')!.textContent).toContain('100')
    await openTile('Lanterns')
    await click(byText('Unlock for 40 Credits'))
    expect(document.body.textContent).toContain('Spend 40 of your 100 Credits?')
    const confirmBtn = byText('Confirm unlock')!
    await act(async () => {
      confirmBtn.click()
      confirmBtn.click()
      confirmBtn.click()
    })
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(unlock.mock.calls[0][0]).toBe('p-lan')
    expect(unlock.mock.calls[0]).toHaveLength(2) // product + idempotency key; never a price
    expect((byText('Unlocking…') as HTMLButtonElement).disabled).toBe(true)
    await act(async () =>
      resolve({ data: { status: 'completed', replayed: false, purchaseId: 'pu1', productId: 'p-lan', creditsCharged: 40, balance: 60, giftId: null }, error: null })
    )
    expect(document.body.textContent).toContain('Unlocked. It’s yours to send.')
    expect(q('[data-testid="credit-balance"]')!.textContent).toContain('60')
    expect(tiles().find((t) => t.getAttribute('aria-label')!.startsWith('Lanterns'))!.dataset.state).toBe('owned')
  })

  it('a failed attempt shows member copy and "Try again" reuses the SAME idempotency key', async () => {
    const unlock = vi
      .fn<UnlockFn>()
      .mockResolvedValueOnce({ data: null, error: { code: 'unexpected', message: 'Something went wrong. Please try again.' } })
      .mockResolvedValueOnce({ data: { status: 'completed', replayed: true, purchaseId: 'pu1', productId: 'p-lan', creditsCharged: 40, balance: 60, giftId: null }, error: null })
    await render({ marketplace: market({ spendEnabled: true, balance: 100 }), unlock })
    await openTile('Lanterns')
    await click(byText('Unlock for 40 Credits'))
    await click(byText('Confirm unlock'))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Please try again.')
    await click(byText('Try again'))
    expect(unlock).toHaveBeenCalledTimes(2)
    expect(unlock.mock.calls[1][1]).toBe(unlock.mock.calls[0][1])
    expect(document.body.textContent).toContain('Unlocked. It’s yours to send.')
  })

  it('server says commerce is off / account unavailable: the member copy is shown, nothing is granted', async () => {
    const unlock = vi.fn<UnlockFn>().mockResolvedValue({ data: null, error: { code: 'commerce_disabled', message: 'The Tempa shop isn’t open yet.' } })
    await render({ marketplace: market({ spendEnabled: true, balance: 100 }), unlock })
    await openTile('Lanterns')
    await click(byText('Unlock for 40 Credits'))
    await click(byText('Confirm unlock'))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('The Tempa shop isn’t open yet.')
    expect(tiles().find((t) => t.getAttribute('aria-label')!.startsWith('Lanterns'))!.dataset.state).toBe('available')
  })
})

describe('Letter picker mode', () => {
  it('Complimentary and owned Postcards can be used; the key is returned', async () => {
    const onPick = vi.fn()
    await render({ mode: 'pick', onPick })
    await openTile('Essaouira')
    await click(byText('Use this Postcard'))
    expect(onPick).toHaveBeenCalledWith('essaouira')
  })

  it('a premium Postcard the member does not own cannot be used as owned — until unlocked', async () => {
    const onPick = vi.fn()
    const unlock = vi.fn<UnlockFn>().mockResolvedValue({ data: { status: 'completed', replayed: false, purchaseId: 'pu', productId: 'p-lan', creditsCharged: 40, balance: 60, giftId: null }, error: null })
    await render({ mode: 'pick', onPick, marketplace: market({ spendEnabled: true, balance: 100 }), unlock })
    await openTile('Lanterns')
    expect(byText('Use this Postcard')).toBeUndefined()
    await click(byText('Unlock for 40 Credits'))
    await click(byText('Confirm unlock'))
    await click(byText('Use this Postcard'))
    expect(onPick).toHaveBeenCalledWith('lanterns')
  })

  it('pick mode "Yours" lists everything sendable (Complimentary + owned) and never the received-only premium', async () => {
    await render({ mode: 'pick', onPick: vi.fn() })
    await click(byText('Yours'))
    expect(tileTitles().sort()).toEqual(['Bangkok', 'Essaouira', 'Harbour', 'Retired Owned'])
  })
})

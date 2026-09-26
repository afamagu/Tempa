// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CatalogItem, ProductDetail } from '@/lib/admin-commerce'

const rpc = vi.fn()
const push = vi.fn()
const refresh = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => '/admin/commerce/catalog' }))

const { default: CatalogList } = await import('./catalog/catalog-list')
const { default: LifecyclePanel } = await import('./catalog/[id]/lifecycle-panel')
const { default: PricingPanel } = await import('./catalog/[id]/pricing-panel')
const { default: CreditOperation } = await import('./credits/credit-operation')
const { default: GrantEntitlement } = await import('./entitlements/grant-entitlement')
const { activeCommerceTab, COMMERCE_TABS } = await import('./commerce-tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  rpc.mockReset()
  push.mockReset()
  refresh.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const render = (el: React.ReactElement) => act(async () => root.render(el))
const btn = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const click = async (el: Element | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
async function type(el: Element | null, value: string) {
  const input = el as HTMLInputElement
  const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  await act(async () => input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })))
}

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  id: 'x', slug: 'x', product_type: 'postcard', title: 'X', lifecycle_state: 'published', publish_at: null, unpublish_at: null, is_complimentary: true,
  postcard_key: 'x', credit_amount: null, display_order: 0, catalog_active: true, thumbnail: null, price: null, ready: true, review_flag: false, terms: 0, owners: 0, ...over,
})

describe('navigation', () => {
  it('Commerce sections are real destinations; the active tab follows the path', () => {
    expect(COMMERCE_TABS.map((t) => t.label)).toEqual(['Overview', 'Catalog', 'Facets', 'Collections', 'Pricing', 'Credits', 'Entitlements & Gifts', 'Orders & Payments', 'Settings', 'Audit'])
    expect(activeCommerceTab('/admin/commerce')).toBe('/admin/commerce')
    expect(activeCommerceTab('/admin/commerce/catalog/abc')).toBe('/admin/commerce/catalog')
  })
})

describe('Catalog list', () => {
  const items = [
    item({ id: 'a', title: 'Essaouira' }),
    item({ id: 'b', title: 'Lagos Evening', is_complimentary: false, price: 40, lifecycle_state: 'draft', ready: false }),
    item({ id: 'c', title: 'Thank you', product_type: 'gift', postcard_key: null, is_complimentary: false, price: 15, lifecycle_state: 'published', publish_at: '2999-01-01T00:00:00Z' }),
  ]
  const titles = () => [...container.querySelectorAll('ul li a')].map((a) => a.querySelector('.font-medium')?.textContent)

  it('lists human rows (no UUIDs), with state and price; filters by type, state and attention; searches', async () => {
    await render(<CatalogList items={items} />)
    expect(titles()).toEqual(['Essaouira', 'Lagos Evening', 'Thank you'])
    expect(container.textContent).toContain('Complimentary')
    expect(container.textContent).toContain('40 Credits')
    expect(container.textContent).toContain('Scheduled')
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    await click(btn('Gifts'))
    expect(titles()).toEqual(['Thank you'])
    await click(btn('All'))
    await click(btn('Drafts'))
    expect(titles()).toEqual(['Lagos Evening'])
    await click(btn('Any state'))
    await click(btn('Needs attention'))
    expect(titles()).toEqual(['Lagos Evening'])
    await click(btn('Needs attention'))
    await type(container.querySelector('input[type="search"]'), 'essa')
    expect(titles()).toEqual(['Essaouira'])
  })

  it('New product creates a DRAFT through the admin RPC and opens it', async () => {
    rpc.mockResolvedValue({ data: 'new-id', error: null })
    await render(<CatalogList items={items} />)
    await click(btn('New product'))
    await type(container.querySelector('input[maxlength="140"]'), 'Thank you note')
    await act(async () => (container.querySelector('form') as HTMLFormElement).requestSubmit())
    expect(rpc).toHaveBeenCalledWith('admin_commerce_create_product', expect.objectContaining({ p_product_type: 'gift', p_title: 'Thank you note' }))
    expect(push).toHaveBeenCalledWith('/admin/commerce/catalog/new-id')
  })
})

const detail = (over: Partial<ProductDetail['product']> = {}, readiness: ProductDetail['readiness'] = []): ProductDetail => ({
  product: {
    id: 'p1', slug: 'postcard-lagos', product_type: 'postcard', title: 'Lagos Evening', short_description: null, story_description: null, lifecycle_state: 'draft',
    publish_at: null, unpublish_at: null, is_complimentary: false, entitlement_model: 'durable', postcard_key: 'lagos', credit_amount: null, preview_policy: 'still_only',
    rights_review_state: 'not_required', rights_review_notes: null, cultural_review_state: 'hold', cultural_review_notes: 'x', display_order: 0, ...over,
  },
  catalog: null, postcard_versions: [], versions: [], credit_prices: [], price_books: [], terms: [], collections: [], bundle_versions: [],
  readiness, owners: 0, purchases: 0,
})

describe('Publishing', () => {
  it('Publish is disabled until every required checklist item passes; the checklist explains why', async () => {
    await render(
      <LifecyclePanel
        detail={detail({}, [
          { key: 'artwork', label: 'Current artwork version', ok: true, required: true },
          { key: 'price', label: 'A published Credit price', ok: false, required: true },
          { key: 'cultural', label: 'Cultural review cleared', ok: false, required: true },
          { key: 'description', label: 'Short description', ok: false, required: false },
        ])}
      />
    )
    expect(btn('Publish')!.disabled).toBe(true)
    expect(container.textContent).toContain('Complete the required items above to publish.')
    expect(container.textContent).toContain('(recommended)')
  })

  it('a future start schedules it (published + future publish_at), with confirmation and reason', async () => {
    rpc.mockResolvedValue({ data: { status: 'updated' }, error: null })
    await render(<LifecyclePanel detail={detail({ cultural_review_state: 'approved' }, [{ key: 'artwork', label: 'Artwork', ok: true, required: true }])} />)
    await type(container.querySelector('input[type="datetime-local"]'), '2030-01-01T09:00')
    await click(btn('Schedule'))
    expect(container.textContent).toContain('Schedule “Lagos Evening” to go on sale')
    await click(btn('Schedule'))
    expect(rpc).toHaveBeenCalledWith('admin_commerce_set_lifecycle', expect.objectContaining({ p_product_id: 'p1', p_state: 'published', p_publish_at: new Date('2030-01-01T09:00').toISOString() }))
    expect(refresh).toHaveBeenCalled()
  })

  it('server refusals show admin copy, not database text', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'COMMERCE:not_ready' } })
    await render(<LifecyclePanel detail={detail({ cultural_review_state: 'approved' }, [{ key: 'artwork', label: 'Artwork', ok: true, required: true }])} />)
    await click(btn('Publish'))
    await click(btn('Publish'))
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('complete the required checklist items first')
  })
})

describe('Pricing', () => {
  it('Credit price: history is read-only; a new price is a new row (never an edit)', async () => {
    rpc.mockResolvedValue({ data: 'price', error: null })
    await render(
      <PricingPanel
        detail={{
          ...detail(),
          credit_prices: [{ id: 'cp1', credit_amount: 40, effective_from: '2026-01-01T00:00:00Z', effective_to: null, state: 'published', purchases: 3 }],
        }}
      />
    )
    expect(container.textContent).toContain('40 Credits')
    expect(container.textContent).toContain('Current')
    expect(container.querySelectorAll('input[value="40"]').length).toBe(0)
    await type(container.querySelector('input[inputmode="numeric"]'), '55')
    await act(async () => (container.querySelector('form') as HTMLFormElement).requestSubmit())
    expect(rpc).toHaveBeenCalledWith('admin_commerce_set_price', expect.objectContaining({ p_kind: 'credit', p_product_id: 'p1', p_amount: 55, p_as_draft: false }))
  })

  it('Credit pack local prices: minor units, USD reference, and "*" explained as a fallback only', async () => {
    await render(<PricingPanel detail={{ ...detail({ product_type: 'credit_pack', credit_amount: 300, postcard_key: null }), price_books: [{ id: 'b1', market: '*', currency: 'USD', amount_minor: 499, usd_reference_minor: 499, effective_from: '2026-01-01T00:00:00Z', effective_to: null, state: 'published' }] }} />)
    expect(container.textContent).toContain('Fallback (*) · $4.99')
    expect(container.textContent).toMatch(/price fallback.*does not\s*authorize selling in every country/)
  })
})

describe('Credits', () => {
  it('two-step confirm shows the resulting balance; a correction below zero is blocked', async () => {
    await render(<CreditOperation memberId="m1" memberLabel="Dave" balance={10} closed={false} />)
    await type(container.querySelector('select'), 'correction')
    await type(container.querySelector('select[aria-label="Add or remove"]'), '-1')
    const inputs = container.querySelectorAll('input')
    await type(inputs[0], '15')
    await type(inputs[1], 'Fix')
    await click(btn('Review'))
    expect(container.textContent).toContain('10 Credits →')
    expect(container.textContent).toContain('can’t take the balance below zero')
    expect(btn('Confirm')!.disabled).toBe(true)
  })

  it('grant: reason required; one idempotency key per intent, reused on retry', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } }).mockResolvedValueOnce({ data: { status: 'completed' }, error: null })
    await render(<CreditOperation memberId="m1" memberLabel="Dave" balance={10} closed={false} />)
    const inputs = container.querySelectorAll('input')
    await type(inputs[0], '25')
    expect(btn('Review')!.disabled).toBe(true)
    await type(inputs[1], 'Welcome back')
    await click(btn('Review'))
    expect(container.textContent).toContain('+25 for Dave: 10 Credits →')
    await click(btn('Confirm'))
    await click(btn('Confirm'))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0][0]).toBe('admin_grant_credits')
    expect(rpc.mock.calls[1][1].p_idempotency_key).toBe(rpc.mock.calls[0][1].p_idempotency_key)
    expect(container.textContent).toContain('New balance 35 Credits')
  })

  it('closed accounts cannot receive grants', async () => {
    await render(<CreditOperation memberId="m1" memberLabel="Closed account" balance={0} closed />)
    expect(container.textContent).toContain('Grants aren’t possible for a closed account.')
  })
})

describe('Entitlements', () => {
  it('official-use grant needs a product and a reason, confirms, then calls the audited grant RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'granted' }, error: null })
    await render(<GrantEntitlement memberId="adm" memberLabel="Tempa Official" owned={[]} products={[{ id: 'p1', title: 'Lagos Evening', type: 'postcard' }]} />)
    expect(btn('Grant')!.disabled).toBe(true)
    await type(container.querySelector('select'), 'p1')
    await type(container.querySelector('input'), 'Official Lagos Dispatch artwork')
    await click(btn('Grant'))
    expect(container.textContent).toContain('no Credits are charged')
    await click(btn('Grant'))
    expect(rpc).toHaveBeenCalledWith('admin_commerce_grant_entitlement', { p_user_id: 'adm', p_product_id: 'p1', p_purpose: 'official_use', p_reason: 'Official Lagos Dispatch artwork' })
    expect(container.textContent).toContain('Granted.')
  })
})

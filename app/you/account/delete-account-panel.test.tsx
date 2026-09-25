// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./actions', () => ({ deleteMyAccount: vi.fn() }))

const { default: DeleteAccountPanel } = await import('./delete-account-panel')

let root: Root
let container: HTMLDivElement
async function mount(action: (c: string) => Promise<{ ok: false; error: string } | void>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<DeleteAccountPanel action={action} />))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement
async function type(value: string) {
  const input = document.querySelector('input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Delete account — deliberate two-step confirmation', () => {
  it('first step only opens the explanation; nothing is deleted', async () => {
    const action = vi.fn()
    await mount(action)
    await act(async () => button('Delete account').click())
    const text = document.body.textContent ?? ''
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    expect(text).toContain('This is permanent')
    expect(text).toContain('stay in the recipient’s mailbox')
    expect(text).toMatch(/safety, preventing fraud and abuse, legal compliance or audit/)
    expect(action).not.toHaveBeenCalled()
  })

  it('18. "Delete my account" stays disabled until exactly DELETE is typed', async () => {
    const action = vi.fn()
    await mount(action)
    await act(async () => button('Delete account').click())
    expect(button('Delete my account').disabled).toBe(true)
    await type('delete')
    expect(button('Delete my account').disabled).toBe(true)
    await type('DELETE')
    expect(button('Delete my account').disabled).toBe(false)
  })

  it('submits only the typed confirmation and shows a failure without claiming success', async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: 'We couldn’t delete your account. Nothing has been changed — please try again.' }))
    await mount(action)
    await act(async () => button('Delete account').click())
    await type('DELETE')
    await act(async () => button('Delete my account').click())
    expect(action).toHaveBeenCalledWith('DELETE')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Nothing has been changed')
    expect(document.body.textContent).not.toMatch(/has been deleted/)
  })

  it('"Keep my account" closes without deleting', async () => {
    const action = vi.fn()
    await mount(action)
    await act(async () => button('Delete account').click())
    await act(async () => button('Keep my account').click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})

describe('placement', () => {
  it('You links to You → Account; the Account page hosts the panel and legal links', () => {
    const you = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
    const account = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
    expect(you).toContain('href="/you/account"')
    expect(account).toContain('<DeleteAccountPanel />')
    for (const href of ['/terms', '/privacy', '/community-guidelines', '/safety']) expect(account).toContain(`'${href}'`)
    expect(account).toContain('Staff accounts are closed by Tempa administrators')
  })

  it('the public confirmation page is honest about an unfinished cleanup', async () => {
    const { default: AccountDeletedPage } = await import('@/app/account-deleted/page')
    const done = renderToStaticMarkup(await AccountDeletedPage({ searchParams: Promise.resolve({}) }))
    const pending = renderToStaticMarkup(await AccountDeletedPage({ searchParams: Promise.resolve({ cleanup: 'pending' }) }))
    expect(done).toContain('Your account has been deleted')
    expect(pending).toContain('Your account has been closed')
    expect(pending).toContain('didn’t finish')
    expect(pending).not.toContain('has been deleted')
  })
})

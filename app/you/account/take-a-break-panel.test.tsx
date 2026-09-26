// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./actions', () => ({ deactivateMyAccount: vi.fn(), deleteMyAccount: vi.fn(), reactivateMyAccount: vi.fn() }))

const { default: TakeABreakPanel } = await import('./take-a-break-panel')
const { default: DeleteAccountPanel } = await import('./delete-account-panel')
const { default: ReturnToTempaButton } = await import('@/app/account-paused/return-to-tempa-button')

let root: Root
let container: HTMLDivElement
async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(node))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement
const radio = (labelText: string) =>
  Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.includes(labelText))?.querySelector('input') as HTMLInputElement
async function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Take a break', () => {
  it('I. can be confirmed without giving any reason', async () => {
    const action = vi.fn(async () => undefined)
    await mount(<TakeABreakPanel action={action} />)
    await act(async () => button('Deactivate Tempa').click())
    expect(document.body.textContent).toContain('your letters, Keepsakes and settings wait for you'.replace('your', 'Your'))
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Deactivate Tempa') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    expect(action).toHaveBeenCalledWith({ reasonCode: null, reasonDetail: '' })
  })

  it('"Something else" reveals an optional note and submits the stable code', async () => {
    const action = vi.fn(async () => undefined)
    await mount(<TakeABreakPanel action={action} />)
    await act(async () => button('Deactivate Tempa').click())
    expect(document.querySelector('textarea')).toBeNull()
    await act(async () => radio('Something else').click())
    await setValue(document.querySelector('textarea')!, 'Moving house')
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Deactivate Tempa') as HTMLButtonElement
    await act(async () => confirm.click())
    expect(action).toHaveBeenCalledWith({ reasonCode: 'something_else', reasonDetail: 'Moving house' })
  })

  it('a failed pause shows an honest error', async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: 'We couldn’t pause your account. Nothing has been changed — please try again.' }))
    await mount(<TakeABreakPanel action={action} />)
    await act(async () => button('Deactivate Tempa').click())
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Deactivate Tempa') as HTMLButtonElement
    await act(async () => confirm.click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Nothing has been changed')
  })
})

describe('Delete account — optional reason + Take a break instead', () => {
  it('I. the reason is optional and deletion stays directly available', async () => {
    const action = vi.fn(async () => undefined)
    await mount(<DeleteAccountPanel action={action} takeBreakHref="#take-a-break" />)
    await act(async () => button('Delete account').click())
    const instead = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === 'Take a break instead')
    expect(instead?.getAttribute('href')).toBe('#take-a-break')
    await act(async () => radio('I don’t use Tempa anymore').click())
    await setValue(document.querySelector('[role="dialog"] input[autocomplete="off"]') as HTMLInputElement, 'DELETE')
    await act(async () => button('Delete my account').click())
    expect(action).toHaveBeenCalledWith('DELETE', { reasonCode: 'not_using_tempa', reasonDetail: '' })
  })
})

describe('/account-paused', () => {
  it('Return to Tempa explicitly calls reactivation', async () => {
    const action = vi.fn(async () => undefined)
    await mount(<ReturnToTempaButton action={action} />)
    await act(async () => button('Return to Tempa').click())
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('page: never silently reactivates; offers Return, Sign out and Delete', () => {
    const page = readFileSync(path.join(__dirname, '..', '..', 'account-paused', 'page.tsx'), 'utf8')
    expect(page).toContain('Your Tempa is waiting.')
    expect(page).toContain('<ReturnToTempaButton />')
    expect(page).toContain('action={signOutAndReturnToSignIn}')
    expect(page).toContain('<DeleteAccountPanel />')
    expect(page).not.toContain('reactivate_my_account')
    expect(page).toContain("if (lifecycle !== 'deactivated') redirect('/home')")
  })
})

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileForm from './profile-form'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({createClient: () => ({rpc})}))
vi.mock('next/navigation', () => ({useRouter: () => ({push:vi.fn(),refresh:vi.fn()})}))
let root: Root
let host: HTMLDivElement
function type(value:string) {
  const input=host.querySelector<HTMLInputElement>('#pseudonym')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value)
  input.dispatchEvent(new Event('input',{bubbles:true}))
}
beforeEach(async () => {
  vi.useFakeTimers();rpc.mockReset()
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async () => {root.render(<NextIntlClientProvider locale="en" messages={en}><ProfileForm userId="member" /></NextIntlClientProvider>)})
})
afterEach(async () => {
  await act(async () => root.unmount());host.remove();vi.useRealTimers()
})
describe('reserved pseudonym form', () => {
  it('shows the reserved message, marks the field and disables Continue without an RPC', async () => {
    await act(async () => type('Lady Larkspurr'))
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('That name is reserved.')
    expect(host.querySelector('#pseudonym')?.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('a late availability response cannot overwrite a newly reserved name', async () => {
    let resolve!: (value:unknown) => void
    rpc.mockReturnValue(new Promise(r => {resolve=r}))
    await act(async () => type('Quiet Harbor'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => type('Tempa Support'))
    await act(async () => {resolve({data:true,error:null})})
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('That name is reserved.')
    expect(host.textContent).not.toContain('Available')
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })
})

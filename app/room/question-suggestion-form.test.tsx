// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import en from '@/messages/en.json'
import QuestionSuggestionForm from './question-suggestion-form'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/app/member-questions/actions', () => ({ publishMemberQuestion: rpc }))
let root: Root
let host: HTMLDivElement
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
}
async function writeQuestion(value: string) {
  await act(async () => button(en.RoomEngagement.suggestOne).click())
  await act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value)
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })
}
beforeEach(async () => {
  rpc.mockReset()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><QuestionSuggestionForm /></NextIntlClientProvider>))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
describe('public member questions with editorial submission', () => {
  it('rejects an incomplete question before making a database call', async () => {
    await writeQuestion('Why?')
    await act(async () => button(en.RoomEngagement.sendSuggestion).click())
    expect(rpc).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.RoomEngagement.invalidSuggestion)
  })
  it('saves only the question and explicit credit choice, with editorial-review confirmation', async () => {
    rpc.mockResolvedValue({ saved: true })
    await writeQuestion('What has stayed with you this year?')
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => button(en.RoomEngagement.sendSuggestion).click())
    expect(rpc).toHaveBeenCalledWith('What has stayed with you this year?', true, false)
    expect(host.textContent).toContain('Manage it on your profile')
  })
  it('requires an explicit acknowledgement before publishing warned text', async () => {
    rpc.mockResolvedValueOnce({ warning: true }).mockResolvedValueOnce({ saved: true })
    await writeQuestion('What has stayed with you this year?')
    await act(async () => button(en.RoomEngagement.sendSuggestion).click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => button('Publish anyway').click())
    expect(rpc).toHaveBeenLastCalledWith('What has stayed with you this year?', false, true)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps blocked content editable and does not show a success message', async () => {
    rpc.mockResolvedValue({ error: 'Please revise this question.' })
    await writeQuestion('What has stayed with you this year?')
    await act(async () => button(en.RoomEngagement.sendSuggestion).click())
    expect(host.querySelector('textarea')?.value).toBe('What has stayed with you this year?')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Please revise this question.')
  })
  it('recovers after a network failure without exposing provider details', async () => {
    rpc.mockRejectedValue(new Error('private SQL/database detail'))
    await writeQuestion('What has stayed with you this year?')
    await act(async () => button(en.RoomEngagement.sendSuggestion).click())
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.RoomEngagement.suggestFailed)
    expect(host.textContent).not.toContain('private SQL')
    expect(button(en.RoomEngagement.sendSuggestion).disabled).toBe(false)
  })
})

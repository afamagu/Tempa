// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { Editor, EditorContent } from '@tiptap/react'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import en from '@/messages/en.json'
import CorrespondentPicker from './correspondent-picker'
import { findCorrespondents } from './correspondent-actions'

vi.mock('./correspondent-actions', () => ({ findCorrespondents: vi.fn() }))
vi.mock('./profile-identity-mark', () => ({ default: () => <span>Mark</span> }))
let root: Root
let host: HTMLDivElement
const selected = vi.fn()
function Harness() {
  const [value, setValue] = useState('Dear @We, how are you?')
  return <NextIntlClientProvider locale="en" messages={en}><CorrespondentPicker onChange={setValue} onSelect={selected}><textarea value={value} onChange={(event) => setValue(event.target.value)} /></CorrespondentPicker></NextIntlClientProvider>
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.mocked(findCorrespondents).mockResolvedValue({ people: [{ userId: 'u2', pseudonym: 'Weak', markUrl: null }], error: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.clearAllMocks() })
async function openAtCaret() {
  const input = host.querySelector('textarea')!
  input.focus(); input.setSelectionRange(8,8)
  await act(async () => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', bubbles: true })))
  await act(async () => vi.advanceTimersByTimeAsync(200))
  return input
}
describe('shared correspondent picker', () => {
  it('replaces only the token at the caret and retains the rest of a controlled draft', async () => {
    await act(async () => root.render(<Harness/>))
    const input = await openAtCaret()
    expect(findCorrespondents).toHaveBeenCalledWith('We')
    await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click())
    expect(input.value).toBe('Dear @Weak , how are you?')
    expect(selected).toHaveBeenCalledWith({ userId: 'u2', pseudonym: 'Weak', markUrl: null })
    await act(async () => vi.runOnlyPendingTimersAsync())
    expect(input.selectionStart).toBe(11)
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await act(async () => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'h', bubbles: true })))
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })
  it('handles keyboard selection and Escape without changing the draft', async () => {
    await act(async () => root.render(<Harness/>))
    const input = await openAtCaret()
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(input.value).toBe('Dear @We, how are you?')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await openAtCaret()
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(input.value).toContain('@Weak ')
  })
  it('remains visible while scrolling and resizing with a phone keyboard open, until explicitly closed', async () => {
    const viewport = new EventTarget() as EventTarget & { offsetTop: number; offsetLeft: number; height: number; width: number }
    Object.assign(viewport, { offsetTop: 0, offsetLeft: 0, height: 300, width: 378 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    await act(async () => root.render(<Harness/>))
    await openAtCaret()
    const menu = document.querySelector<HTMLElement>('[data-correspondent-menu]')!
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8)
    expect(Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(292)
    await act(async () => { window.dispatchEvent(new Event('scroll')); viewport.dispatchEvent(new Event('resize')) })
    expect(document.querySelector('[data-correspondent-menu]')).toBeTruthy()
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
    expect(document.querySelector('[data-correspondent-menu]')).toBeNull()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  })
  it('shows six compact choices and replaces them with the expanded list', async () => {
    vi.mocked(findCorrespondents).mockResolvedValue({ people: Array.from({ length: 9 }, (_,i)=>({userId:`u${i}`,pseudonym:`Person ${i}`,markUrl:null})), error:false })
    await act(async () => root.render(<Harness/>))
    await openAtCaret()
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(6)
    await act(async () => [...document.querySelectorAll('button')].find(b=>b.textContent==='See all correspondents')!.click())
    expect(document.querySelectorAll('[data-correspondent-menu]')).toHaveLength(1)
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(9)
  })
  it('inserts through Tiptap so ordinary markup and undo remain valid', async () => {
    const editor = new Editor({ extensions: baseWritingExtensions(), content: '<p>Dear @We</p>' })
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><CorrespondentPicker editor={editor}><EditorContent editor={editor}/></CorrespondentPicker></NextIntlClientProvider>))
    await act(async () => { editor.commands.setTextSelection(9); editor.commands.insertContent('a'); })
    await act(async () => vi.advanceTimersByTimeAsync(200))
    await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click())
    expect(editor.getText()).toBe('Dear @Weak ')
    await act(async () => editor.commands.undo())
    expect(editor.getText()).toContain('@Wea')
    editor.destroy()
  })
})

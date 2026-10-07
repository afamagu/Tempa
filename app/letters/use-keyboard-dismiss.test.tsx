// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dragMayDismiss,
  isIntentionalVerticalDrag,
  isTextEntryElement,
  shouldDismissOnTap,
  useKeyboardDismiss,
} from './use-keyboard-dismiss'

function Composer() {
  const ref = useRef<HTMLDivElement | null>(null)
  useKeyboardDismiss(ref)
  return (
    <div ref={ref}>
      <div id="editor" contentEditable suppressContentEditableWarning>
        <p id="para">Dear friend,</p>
      </div>
      <p id="page-text">Some surrounding page text</p>
      <button id="add-moment" type="button">Add Moment</button>
      <textarea id="back-message" defaultValue="" />
    </div>
  )
}

function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  const list = type === 'touchend' ? [] : [{ clientX: x, clientY: y }]
  Object.defineProperty(event, 'touches', { value: list })
  target.dispatchEvent(event)
}

let now = 1000
let container: HTMLDivElement
let root: Root
let coarse = true

beforeEach(async () => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  window.matchMedia = ((query: string) => ({ matches: coarse && query === '(pointer: coarse)' })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Composer />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  coarse = true
})

const $ = (id: string) => document.getElementById(id) as HTMLElement

function focusEditor() {
  // jsdom has no isContentEditable; model the real browser.
  Object.defineProperty($('editor'), 'isContentEditable', { value: true, configurable: true })
  $('editor').tabIndex = 0
  $('editor').focus()
  expect(document.activeElement).toBe($('editor'))
}

describe('tap outside the writing field', () => {
  it('a tap on page text dismisses the keyboard (blurs the editor); the draft is untouched', () => {
    focusEditor()
    touch($('page-text'), 'touchstart', 10, 10)
    touch($('page-text'), 'touchend', 10, 10)
    expect(document.activeElement).not.toBe($('editor'))
    expect($('para').textContent).toBe('Dear friend,')
  })

  it('a tap on a control (Add Moment) never blurs — the control keeps working with the cursor in place', () => {
    focusEditor()
    touch($('add-moment'), 'touchstart', 10, 10)
    touch($('add-moment'), 'touchend', 10, 10)
    expect(document.activeElement).toBe($('editor'))
  })

  it('a tap inside the editor itself keeps the keyboard', () => {
    focusEditor()
    touch($('para'), 'touchstart', 10, 10)
    touch($('para'), 'touchend', 10, 10)
    expect(document.activeElement).toBe($('editor'))
  })
})

describe('intentional vertical drag', () => {
  it('a quick vertical drag inside the editor keeps the keyboard and selection context', () => {
    focusEditor()
    touch($('para'), 'touchstart', 100, 300)
    now += 60
    touch($('para'), 'touchmove', 102, 260)
    expect(document.activeElement).toBe($('editor'))
  })

  it('a quick vertical drag on surrounding page text may dismiss the keyboard', () => {
    focusEditor()
    touch($('page-text'), 'touchstart', 100, 300)
    now += 60
    touch($('page-text'), 'touchmove', 102, 260)
    expect(document.activeElement).not.toBe($('editor'))
  })

  it('a long-press then drag (text selection) keeps the keyboard', () => {
    focusEditor()
    touch($('para'), 'touchstart', 100, 300)
    now += 700
    touch($('para'), 'touchmove', 100, 250)
    expect(document.activeElement).toBe($('editor'))
  })

  it('a sideways swipe keeps the keyboard', () => {
    focusEditor()
    touch($('para'), 'touchstart', 100, 300)
    now += 50
    touch($('para'), 'touchmove', 160, 290)
    expect(document.activeElement).toBe($('editor'))
  })
})

describe('mouse / desktop', () => {
  it('does nothing without a coarse pointer', async () => {
    await act(async () => root.unmount())
    coarse = false
    root = createRoot(container)
    await act(async () => root.render(<Composer />))
    focusEditor()
    touch($('page-text'), 'touchstart', 10, 10)
    touch($('page-text'), 'touchend', 10, 10)
    expect(document.activeElement).toBe($('editor'))
  })
})

describe('pure decisions', () => {
  it('text-entry detection', () => {
    const input = document.createElement('input')
    input.type = 'text'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isTextEntryElement(input)).toBe(true)
    expect(isTextEntryElement(checkbox)).toBe(false)
    expect(isTextEntryElement(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryElement(document.createElement('button'))).toBe(false)
    expect(isTextEntryElement(null)).toBe(false)
  })

  it('never dismisses for links, buttons, fields or dialogs', () => {
    const field = document.createElement('textarea')
    for (const html of ['<button>x</button>', '<a href="/x">x</a>', '<input>', '<div role="dialog"><p>x</p></div>', '<label>x</label>']) {
      const host = document.createElement('div')
      host.innerHTML = html
      const target = host.querySelector('p') ?? (host.firstElementChild as Element)
      expect(shouldDismissOnTap(target, field)).toBe(false)
    }
    expect(shouldDismissOnTap(document.createElement('p'), field)).toBe(true)
    expect(shouldDismissOnTap(document.createElement('p'), document.createElement('div'))).toBe(false)
  })

  it('drag thresholds', () => {
    expect(isIntentionalVerticalDrag(0, 12, 100)).toBe(true)
    expect(isIntentionalVerticalDrag(0, -30, 100)).toBe(true)
    expect(isIntentionalVerticalDrag(0, 8, 100)).toBe(false)
    expect(isIntentionalVerticalDrag(20, 20, 100)).toBe(false)
    expect(isIntentionalVerticalDrag(0, 40, 800)).toBe(false)
  })

  it('a drag starting in any text-entry surface belongs to that surface', () => {
    expect(dragMayDismiss(document.createElement('textarea'))).toBe(false)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const paragraph = document.createElement('p')
    editable.appendChild(paragraph)
    expect(dragMayDismiss(paragraph)).toBe(false)
    expect(dragMayDismiss(document.createElement('p'))).toBe(true)
  })
})

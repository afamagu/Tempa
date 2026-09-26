// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchableMultiSelect from './searchable-multi-select'

const OPTIONS = [
  { value: 'English', label: 'English' },
  { value: 'French', label: 'French' },
  { value: 'Yoruba', label: 'Yoruba' },
]

const onChangeSpy = vi.fn()
/** The latest selection the component reported (empty before any change). */
const lastValues = (): string[] => onChangeSpy.mock.calls.at(-1)?.[0] ?? []

function Harness({ initial = [] as string[] }) {
  const [values, setValues] = useState<string[]>(initial)
  return (
    <div>
      <SearchableMultiSelect
        id="languages"
        values={values}
        onChange={(next) => {
          onChangeSpy(next)
          setValues(next)
        }}
        options={OPTIONS}
        placeholder="Languages"
      />
      <button type="button" data-testid="next-field">
        Next field
      </button>
    </div>
  )
}

describe('SearchableMultiSelect (onboarding Languages)', () => {
  let container: HTMLDivElement
  let root: Root

  const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!
  const listbox = () => container.querySelector('[role="listbox"]')
  const option = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="option"] button')].find((b) => b.textContent === label)
  const chips = () => [...container.querySelectorAll('span')].map((s) => s.textContent?.replace('×', '').trim())

  async function openByFocus() {
    await act(async () => {
      input().focus()
    })
  }

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onChangeSpy.mockReset()
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('selecting a language closes the list and keeps the language selected', async () => {
    await openByFocus()
    expect(listbox()).not.toBeNull()

    await act(async () => option('French')!.click())

    expect(listbox()).toBeNull()
    expect(lastValues()).toEqual(['French'])
    expect(chips()).toContain('French')
    expect(input().getAttribute('aria-expanded')).toBe('false')
  })

  it('tapping the (still focused) field again reopens it so another language can be added', async () => {
    await openByFocus()
    await act(async () => option('French')!.click())
    expect(listbox()).toBeNull()
    expect(document.activeElement).toBe(input()) // no new focus event on the next tap

    await act(async () => input().click())
    expect(listbox()).not.toBeNull()
    // the already-selected language is not offered again
    expect(option('French')).toBeUndefined()

    await act(async () => option('Yoruba')!.click())
    expect(lastValues()).toEqual(['French', 'Yoruba'])
    expect(listbox()).toBeNull()
  })

  it('an outside pointer/touch dismisses the list without changing the selection', async () => {
    await openByFocus()
    expect(listbox()).not.toBeNull()

    const outside = container.querySelector<HTMLButtonElement>('[data-testid="next-field"]')!
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })

    expect(listbox()).toBeNull()
    expect(onChangeSpy).not.toHaveBeenCalled()
  })

  it('a pointer inside the control does not dismiss it', async () => {
    await openByFocus()
    await act(async () => {
      input().dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(listbox()).not.toBeNull()
  })

  it('removing a chip still works and keyboard selection still closes the list', async () => {
    await openByFocus()
    await act(async () => option('English')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove English"]')!.click())
    expect(lastValues()).toEqual([])

    await act(async () => input().click())
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(lastValues()).toEqual(['English'])
    expect(listbox()).toBeNull()
  })
})

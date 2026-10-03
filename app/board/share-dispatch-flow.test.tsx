// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import ShareDispatchButton from './share-dispatch-button'
import { shareDispatch } from '@/lib/dispatches'
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/dispatches', () => ({ shareDispatch: vi.fn() }))
let root: Root
let host: HTMLDivElement
const copy = vi.fn()
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(shareDispatch).mockResolvedValue({ data: { id: 'public-token' }, error: null } as Awaited<ReturnType<typeof shareDispatch>>)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy.mockResolvedValue(undefined) } })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  await act(async () => root.render(<ShareDispatchButton dispatchId="private-id" title="Title" authorPseudonym="Writer" />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks() })
it('copies the issued public token, never the current Board URL, and exposes an open link', async () => {
  await act(async () => host.querySelector('button')!.click())
  expect(copy).toHaveBeenCalledWith(`${location.origin}/d/public-token`)
  expect(host.querySelector('a')?.getAttribute('href')).toBe(`${location.origin}/d/public-token`)
})
it('falls back to copying when the native share service fails', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new Error('Unavailable')) })
  await act(async () => host.querySelector('button')!.click())
  expect(copy).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('Link copied')
})
it('does not copy after an intentional native-share cancellation', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')) })
  await act(async () => host.querySelector('button')!.click())
  expect(copy).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('Could not')
})
it('recovers from a request exception and permits retry', async () => {
  vi.mocked(shareDispatch).mockRejectedValueOnce(new Error('Offline'))
  await act(async () => host.querySelector('button')!.click())
  expect(host.textContent).toContain('Could not complete sharing')
  expect(host.querySelector('button')!.disabled).toBe(false)
  await act(async () => host.querySelector('button')!.click())
  expect(copy).toHaveBeenCalledOnce()
})

// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useEditorVisualViewport } from './use-editor-visual-viewport'

it('reserves keyboard space, freezes pending resize during touch, handles rotation, and restores padding on blur', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 })
  vi.stubGlobal('visualViewport', viewport)
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key))
  const flush = () => { for (const [key, callback] of callbacks) { callbacks.delete(key); callback(0) } }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function Surface() { const ref = useRef<HTMLDivElement>(null); useEditorVisualViewport(ref); return <div ref={ref} style={{ paddingBottom: '8px' }}><textarea /></div> }
  try {
    await act(() => root.render(<Surface />))
    const surface = host.firstElementChild as HTMLElement; const field = host.querySelector('textarea')!
    field.focus(); flush()
    expect(surface.style.paddingBottom).toBe(`calc(${window.innerHeight - 500 + 32}px)`)
    viewport.height = 300; viewport.dispatchEvent(new Event('resize'))
    document.dispatchEvent(new Event('touchstart')); flush()
    expect(surface.style.paddingBottom).toBe(`calc(${window.innerHeight - 500 + 32}px)`)
    document.dispatchEvent(new Event('touchcancel')); flush()
    expect(surface.style.paddingBottom).toBe(`calc(${window.innerHeight - 300 + 32}px)`)
    viewport.height = 600; window.dispatchEvent(new Event('orientationchange')); flush()
    expect(surface.style.paddingBottom).toBe(`calc(${window.innerHeight - 600 + 32}px)`)
    field.blur(); flush(); expect(surface.style.paddingBottom).toBe('8px')
  } finally { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

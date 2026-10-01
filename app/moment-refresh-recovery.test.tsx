// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeViewProps } from '@tiptap/react'
import { PhotoMomentView } from './letters/[letterId]/photo-moment-node'
import { DispatchPhotoMomentView } from './board/dispatch-photo-moment-node'
import { resolveLetterPhotoUrl, resolveDispatchPhotoUrl } from '@/lib/draft-photo-url'

vi.mock('@tiptap/react', async (original) => ({
  ...await original<typeof import('@tiptap/react')>(),
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/draft-photo-url', () => ({ resolveLetterPhotoUrl: vi.fn(), resolveDispatchPhotoUrl: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('restored Moment URL recovery', () => {
  for (const [surface, View, resolve] of [
    ['letter', PhotoMomentView, resolveLetterPhotoUrl],
    ['dispatch', DispatchPhotoMomentView, resolveDispatchPhotoUrl],
  ] as const) {
    it(`${surface}: replaces a broken preview using its preserved path and stops automatic image failures`, async () => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      vi.mocked(resolve).mockResolvedValue({ url: 'https://storage.test/fresh-photo', error: null })
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      const remove = vi.fn()
      const update = vi.fn()
      function Harness() {
        const [attrs, setAttrs] = useState({ imagePath: 'durable/photo.jpg', previewUrl: 'blob:dead-session' as string | null })
        return <View {...({ node: { attrs }, deleteNode: remove, updateAttributes: (patch: Partial<typeof attrs>) => {
          update(patch)
          setAttrs((previous) => ({ ...previous, ...patch }))
        } } as unknown as NodeViewProps)} />
      }
      await act(async () => root.render(<Harness />))
      expect(resolve).not.toHaveBeenCalled()
      await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')))
      expect(resolve).toHaveBeenCalledWith({}, 'durable/photo.jpg')
      expect(host.querySelector('img')!.src).toBe('https://storage.test/fresh-photo')
      expect(update).toHaveBeenCalledWith({ previewUrl: null })
      await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')))
      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('[aria-label="Retry loading this photo"]')).not.toBeNull()
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(remove).not.toHaveBeenCalled()
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Retry loading this photo"]')!.click())
      expect(resolve).toHaveBeenCalledTimes(2)
      expect(host.querySelector('img')).not.toBeNull()
      await act(async () => root.unmount())
      host.remove()
    })
  }
})

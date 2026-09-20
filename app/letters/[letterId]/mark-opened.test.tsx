// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkLetterOpened from './mark-opened'

const refresh = vi.fn()
const rpc = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc }),
}))

describe('MarkLetterOpened', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    refresh.mockReset()
    rpc.mockReset()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('marks the mounted letter opened and refreshes server data after success', async () => {
    rpc.mockResolvedValue({ error: null })

    await act(async () => {
      root.render(<MarkLetterOpened letterId="letter-1" />)
    })

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('mark_letter_opened', { p_letter_id: 'letter-1' })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not refresh when mark_letter_opened fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'failed', code: 'P0001' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root.render(<MarkLetterOpened letterId="letter-2" />)
    })

    expect(rpc).toHaveBeenCalledWith('mark_letter_opened', { p_letter_id: 'letter-2' })
    expect(refresh).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

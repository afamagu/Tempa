import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: vi.fn(),
    from: () => ({ insert: vi.fn(async () => ({ error: null })) }),
  }),
}))

import ReplayMindsGuide from './replay'

describe('ReplayMindsGuide', () => {
  it('renders the Minds walkthrough with a Close affordance — an opt-in replay, not an auto-shown gate', () => {
    const html = renderToStaticMarkup(<ReplayMindsGuide />)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('Welcome to Minds')
  })
})

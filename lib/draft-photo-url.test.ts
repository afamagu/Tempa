import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveLetterPhotoUrl, DRAFT_PHOTO_SIGNED_URL_TTL_SECONDS } from './draft-photo-url'

function fakeSupabase(createSignedUrl: (path: string, ttl: number) => Promise<unknown>) {
  return {
    storage: {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe('letter-photos')
        return { createSignedUrl }
      }),
    },
  } as unknown as SupabaseClient
}

// Live-repair checkpoint (2026-09-08) — the ONE canonical rule both the
// editor's restored-photo NodeView and the Preview-preparation layer
// call. These are the actual regression tests for the exact defect this
// checkpoint fixes: the OLD inline call this replaced discarded its
// `error` entirely, so a genuine failure (RLS denial, no session yet)
// left a photo permanently broken with nothing to explain why.
describe('resolveLetterPhotoUrl', () => {
  it('Part J-A — a restored imagePath resolves into a usable display URL', async () => {
    const supabase = fakeSupabase(async () => ({ data: { signedUrl: 'https://signed.test/corr-1/a.jpg' }, error: null }))
    const result = await resolveLetterPhotoUrl(supabase, 'corr-1/a.jpg')
    expect(result).toEqual({ url: 'https://signed.test/corr-1/a.jpg', error: null })
  })

  it('always signs against the letter-photos bucket and the exact imagePath/TTL given', async () => {
    let capturedPath: string | undefined
    let capturedTtl: number | undefined
    const supabase = fakeSupabase(async (path, ttl) => {
      capturedPath = path
      capturedTtl = ttl
      return { data: { signedUrl: 'https://signed.test/x' }, error: null }
    })
    await resolveLetterPhotoUrl(supabase, 'corr-9/z.jpg')
    expect(capturedPath).toBe('corr-9/z.jpg')
    expect(capturedTtl).toBe(DRAFT_PHOTO_SIGNED_URL_TTL_SECONDS)
  })

  it('a genuine failure (e.g. RLS denial) comes back as a reportable error, never silently swallowed', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: 'new row violates row-level security policy' } }))
    const result = await resolveLetterPhotoUrl(supabase, 'corr-1/denied.jpg')
    expect(result.url).toBeNull()
    expect(result.error).toBe('new row violates row-level security policy')
  })

  it('a response with no signedUrl and no error still reports a non-null error rather than a silent null', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: null }))
    const result = await resolveLetterPhotoUrl(supabase, 'corr-1/odd.jpg')
    expect(result.url).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('never throws — a rejected/thrown call is caught and reported as an error result instead', async () => {
    const supabase = fakeSupabase(async () => {
      throw new Error('network unreachable')
    })
    const result = await resolveLetterPhotoUrl(supabase, 'corr-1/thrown.jpg')
    expect(result).toEqual({ url: null, error: 'network unreachable' })
  })
})

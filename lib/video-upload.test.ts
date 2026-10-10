import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadVideoClip } from './video-upload'
let response = { status: 200, body: '' }
let sent: Blob | undefined
let requests = 0
class FakeXHR {
  upload: { onprogress: (event: unknown) => void } = { onprogress: () => {} }
  onload = () => {}; onerror = () => {}; onabort = () => {}; ontimeout = () => {}
  status = 0; responseText = ''; timeout = 0
  open = vi.fn(); setRequestHeader = vi.fn()
  abort() { this.onabort() }
  send(blob: Blob) { sent = blob; requests++; this.status = response.status; this.responseText = response.body; this.onload() }
}
const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } }, error: null }) } } as unknown as SupabaseClient
beforeEach(() => { requests = 0; response = { status: 200, body: '' }; vi.stubGlobal('XMLHttpRequest', FakeXHR) })
describe('clip upload', () => {
  it('sends only the prepared blob directly to Storage', async () => {
    const clip = new Blob(['selected'], { type: 'video/mp4' })
    await uploadVideoClip(client, 'corr/video/id.mp4', clip, new AbortController().signal, vi.fn())
    expect(sent).toBe(clip); expect(requests).toBe(1)
  })
  it('reports the confirmed production MIME failure clearly', async () => {
    response = { status: 400, body: JSON.stringify({ message: 'mime type video/mp4 is not supported' }) }
    await expect(uploadVideoClip(client, 'corr/video/id.mp4', new Blob(), new AbortController().signal, vi.fn())).rejects.toThrow('not enabled yet')
  })
  it('recovers an uncertain upload when Storage reports the same UUID already exists', async () => {
    response = { status: 400, body: JSON.stringify({ statusCode: '409', message: 'The resource already exists' }) }
    await expect(uploadVideoClip(client, 'corr/video/id.mp4', new Blob(), new AbortController().signal, vi.fn())).resolves.toBeUndefined()
  })
  it('does not attempt uploads without a session', async () => {
    const expired = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } } as unknown as SupabaseClient
    await expect(uploadVideoClip(expired, 'x', new Blob(), new AbortController().signal, vi.fn())).rejects.toThrow('session has expired')
    expect(requests).toBe(0)
  })
})

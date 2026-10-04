import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ getUser: vi.fn(), after: vi.fn(), worker: vi.fn(), service: vi.fn() }))
vi.mock('next/server', () => ({ after: mock.after }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mock.getUser } }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mock.service }))
vi.mock('@/lib/email/mention-worker', () => ({ runMentionEmailWorker: mock.worker }))
vi.mock('@/lib/email/provider', () => ({ sendEmail: vi.fn() }))
import { POST } from './route'
beforeEach(() => { vi.clearAllMocks(); mock.getUser.mockResolvedValue({ data: { user: { id: 'actual-user' } }, error: null }) })
it('rejects foreign origins before accessing a session', async () => {
 expect((await POST(new Request('https://jointempa.com/api/mentions/send', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status).toBe(403)
 expect(mock.getUser).not.toHaveBeenCalled(); expect(mock.after).not.toHaveBeenCalled()
})
it('rejects unsigned callers', async () => {
 mock.getUser.mockResolvedValue({ data: { user: null }, error: null })
 expect((await POST(new Request('https://jointempa.com/api/mentions/send', { method: 'POST', headers: { origin: 'https://jointempa.com' } }))).status).toBe(401)
 expect(mock.after).not.toHaveBeenCalled()
})
it('uses verified identity, ignores submitted identities and responds before delivery', async () => {
 const result = await POST(new Request('https://jointempa.com/api/mentions/send', { method: 'POST', headers: { origin: 'https://jointempa.com' }, body: JSON.stringify({ senderId: 'someone-else', to: 'someone@example.test' }) }))
 expect(result.status).toBe(202); expect(mock.worker).not.toHaveBeenCalled()
 await mock.after.mock.calls[0][0]()
 expect(mock.worker).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'actual-user', siteOrigin: 'https://jointempa.com' }))
})

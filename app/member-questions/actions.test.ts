import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, getUser, from, classify, revalidate } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), classify: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc, from }) }))
vi.mock('@/lib/safety', () => ({ classifyContent: classify }))
vi.mock('next/cache', () => ({ revalidatePath: revalidate }))
import { publishMemberQuestion } from './actions'
const body = 'What makes a place feel like home?'
beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'verified-member' } } })
  rpc.mockImplementation(async (name: string) => ({ data: name === 'check_rate_limit' ? true : 'question-id', error: null }))
  classify.mockReturnValue({ mutationDisposition: 'allow', escalateCase: false, riskBand: 'none', reasonCodes: [] })
})
describe('authenticated question publication', () => {
  it('derives the actor from the verified session and classifies the exact public text', async () => {
    expect(await publishMemberQuestion(`  ${body}  `, true)).toEqual({ saved: true, pending: false })
    expect(classify).toHaveBeenCalledWith(body, { publicSurface: true })
    expect(rpc).toHaveBeenCalledWith('publish_member_question_trusted', expect.objectContaining({ p_actor_id: 'verified-member', p_body: body, p_credit: true }))
  })
  it('fails closed when either rate check fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    expect((await publishMemberQuestion(body, false)).error).toBeTruthy()
    expect(classify).not.toHaveBeenCalled()
    expect(rpc.mock.calls.every(([name]) => name === 'check_rate_limit')).toBe(true)
  })
  it('does not publish without a verified user', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await publishMemberQuestion(body, false)).error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requires acknowledgement and reclassifies the current text when confirmed', async () => {
    classify.mockReturnValue({ mutationDisposition: 'warn', escalateCase: false, reasonCodes: ['PERSONAL_CONTACT_SHARING'] })
    expect((await publishMemberQuestion(body, false)).warning).toBe(true)
    expect(rpc.mock.calls.some(([name]) => name === 'publish_member_question_trusted')).toBe(false)
    expect((await publishMemberQuestion(body, false, true)).saved).toBe(true)
    expect(classify).toHaveBeenCalledTimes(2)
  })
  it('never publishes denied content even if acknowledged', async () => {
    classify.mockReturnValue({ mutationDisposition: 'deny', escalateCase: true, reasonCodes: [] })
    expect((await publishMemberQuestion(body, false, true)).error).toBeTruthy()
    expect(rpc.mock.calls.some(([name]) => name === 'publish_member_question_trusted')).toBe(false)
  })
})

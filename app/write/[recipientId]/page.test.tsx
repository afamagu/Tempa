import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ signedIn: true }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key === 'home' ? 'Home' : 'The Room' }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.signedIn ? { id:'viewer' } : null } }) },
  rpc: async () => ({
    data: [{
      active_limit: 8,
      established_count: 0,
      outgoing_pending_count: 0,
      incoming_pending_count: 0,
      committed_count: 0,
      available_slots: 8,
      outgoing_pending_limit: 2,
      incoming_pending_limit: 2,
      can_start_first_contact: true,
      can_receive_first_contact: true,
      grandfathered: false,
    }],
    error: null,
  }),
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'public_profiles' ? { pseudonym:'Maya' } : { id:'answer', user_id:'member', questions:{prompt:'Question'} } }) }
    return query
  },
}) }))
vi.mock('@/lib/letters', () => ({ getFirstContact: async () => null, closeReasonForSender: vi.fn(), isEffectivelyExpired: vi.fn(), isEstablishedForViewer: vi.fn(), resolveFirstContactDisplayStatus: vi.fn() }))
vi.mock('./first-letter-composer', () => ({ default: () => null }))
vi.mock('@/app/letters/closure-recommendations', () => ({ default: () => null }))
import WriteToPage from './page'
beforeEach(() => { state.signedIn = true })
describe('First-letter return context', () => {
  it('direct introductions return to Home without changing answer context', async () => {
    const page = await WriteToPage({ params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer',source:'member_introduction',returnTo:'/home'}) })
    expect(page.props).toMatchObject({backHref:'/home',backLabel:'Home',questionAnswerId:'answer',recipientId:'member'})
  })
  it('writing from a profile returns to that profile with its Home context intact', async () => {
    const page = await WriteToPage({params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer',returnTo:'/room/member?returnTo=%2Fhome'})})
    expect(page.props).toMatchObject({backHref:'/room/member?returnTo=%2Fhome',backLabel:'Maya'})
  })
  it('unsafe or unrelated return paths fall back to The Room', async () => {
    for (const returnTo of ['https://evil.test','/admin','/write/member']) {
      const page = await WriteToPage({params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer',returnTo})})
      expect(page.props).toMatchObject({backHref:'/room',backLabel:'The Room'})
    }
  })
  it('a signed-out writer retains the complete writing/return destination through sign-in', async () => {
    state.signedIn = false
    await expect(WriteToPage({params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer',source:'member_introduction',returnTo:'/home'})})).rejects.toThrow(`redirect:/sign-in?next=${encodeURIComponent('/write/member?a=answer&source=member_introduction&returnTo=%2Fhome')}`)
  })
})
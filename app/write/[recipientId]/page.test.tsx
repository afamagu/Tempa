import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ signedIn: true, established: false, incoming: false }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key === 'home' ? 'Home' : 'The Room' }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.signedIn ? { id:'viewer' } : null } }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'public_profiles' ? { pseudonym:'Maya' } : { id:'answer', user_id:'member', questions:{prompt:'Question'} } }) }
    return query
  },
}) }))
vi.mock('@/lib/letters', () => ({ getActiveEstablishedCorrespondenceWithUser: async () => state.established ? {id: 'correspondence'} : null, getFirstContact: async (_client: unknown, sender: string) => state.incoming && sender === 'member' ? {id: 'incoming', status: 'sent'} : null, closeReasonForSender: vi.fn(), isEffectivelyExpired: vi.fn(), isEstablishedForViewer: async () => state.established, resolveFirstContactDisplayStatus: vi.fn() }))
vi.mock('./first-letter-composer', () => ({ default: () => null }))
vi.mock('@/app/letters/closure-recommendations', () => ({ default: () => null }))
import WriteToPage from './page'
beforeEach(() => { state.signedIn = true; state.established = false; state.incoming = false })
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

it('answer replies go straight to established correspondence', async () => {
  state.established = true
  await expect(WriteToPage({params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer',returnTo:'/home'})})).rejects.toThrow('redirect:/letters/with/member/write?returnTo=%2Fhome')
})
it('answer replies open an incoming first letter instead of creating a second invitation', async () => {
  state.incoming = true
  await expect(WriteToPage({params:Promise.resolve({recipientId:'member'}),searchParams:Promise.resolve({a:'answer'})})).rejects.toThrow('redirect:/letters/incoming')
})

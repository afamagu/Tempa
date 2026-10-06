import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/member-questions/actions', () => ({ publishMemberQuestion: vi.fn() }))
import ProfileQuestions from './profile-questions'
const question = { id: 'question-id', body: 'What makes a place feel like home?', is_profile_visible: true, moderation_status: 'visible', withdrawn_at: null, credit_if_used: false, selected: false }
const common = { ownerId: 'member-id', name: 'Mia', initial: [question], legacy: [], returnTo: '/room/member-id?returnTo=%2Fletters%2Fdiscover' }
describe('profile questions', () => {
  it('links a visitor to the correct private composer with distinct question and eligible answer context', () => {
    const html = renderToStaticMarkup(<ProfileQuestions {...common} own={false} writeHref="/write/member-id?a=real-answer" />)
    expect(html).toContain('Write from this')
    expect(html).toContain('a=real-answer&amp;mq=question-id&amp;returnTo=')
    expect(html).not.toContain('Hide from profile')
  })
  it('offers owner visibility, withdrawal and credit controls without a self-letter link', () => {
    const html = renderToStaticMarkup(<ProfileQuestions {...common} own writeHref={null} />)
    expect(html).toContain('Hide from profile')
    expect(html).toContain('Remove question')
    expect(html).toContain('Show my name and Mark')
    expect(html).not.toContain('Write to Mia')
  })
  it('continues a pending first contact through its existing letter instead of starting a second one', () => {
    const html = renderToStaticMarkup(<ProfileQuestions {...common} own={false} writeHref={null} pendingLetterHref="/letters/existing" />)
    expect(html).toContain('href="/letters/existing"')
    expect(html).not.toContain('/write/')
  })
  it('shows dates and at most three questions to visitors, with history controls only for the owner', () => {
    const initial=Array.from({length:4},(_,n)=>({...question,id:`q${n}`,body:`Question ${n}`,created_at:'2026-10-01T00:00:00Z'}))
    const visitor=renderToStaticMarkup(<ProfileQuestions {...common} initial={initial} own={false} writeHref="/write/member-id?a=real-answer" />)
    expect(visitor).toContain('1 October 2026');expect(visitor).not.toContain('Question 3')
    expect(visitor).not.toContain('Your question history')
    const owner=renderToStaticMarkup(<ProfileQuestions {...common} initial={initial} own writeHref={null} />)
    expect(owner).toContain('Your question history')
  })
})

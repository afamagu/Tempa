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
    expect(html).toContain('Write to Mia about this')
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
})

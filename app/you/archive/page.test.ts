import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you/archive — separate owner writing surfaces', () => {
  it('keeps Dispatches and Responses separate, with no mixed All tab', () => {
    expect(source).toContain('>Dispatches</Link>')
    expect(source).toContain('>Responses</Link>')
    expect(source).not.toContain('>All</Link>')
  })

  it('is an owner surface under You and keeps the old response workflow inside it', () => {
    expect(source).toContain('active="you"')
    expect(source).toContain("import QuestionWorkspace from '@/app/minds/question-workspace'")
    expect(source).toContain("getEligibleQuestions(supabase, user.id)")
    expect(source).toContain("getMyAnswers(supabase, user.id)")
  })
})

describe('/you/archive — Dispatch ownership and visibility rules', () => {
  it('loads only this member\'s published member Dispatches, newest first', () => {
    expect(source).toContain(".eq('author_id', user.id)")
    expect(source).toContain(".eq('published_as', 'member')")
    expect(source).toContain(".eq('status', 'published')")
    expect(source).toContain(".order('published_at', { ascending: false })")
  })

  it('does not filter moderation_status out, so the owner can retain a private record of hidden Dispatches', () => {
    expect(source).toContain(".select('id, title, body, published_at, moderation_status')")
    expect(source).not.toContain(".eq('moderation_status', 'visible')")
    expect(source).toContain('Hidden by TEMPA.')
  })

  it('scopes topic and reply metadata to the owner Dispatch ids', () => {
    expect(source).toContain(".in('dispatch_id', dispatchIdList)")
  })

  it('respects the existing edit window and reply lock before advertising Edit', () => {
    expect(source).toContain('isWithinDispatchEditWindow(dispatch.published_at)')
    expect(source).toContain('!hasReplies')
  })

  it('does not invent a Worth Reading count before the author-reporting contract exists', () => {
    expect(source).not.toContain('Worth Reading')
    expect(source).not.toContain('worth_reading')
  })
})

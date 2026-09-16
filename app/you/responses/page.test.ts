import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — People Information Architecture
// (Section F). New route; same "not directly unit-tested" convention as
// every other heavy-Supabase async Server Component in this codebase.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you/responses — response management, reused from the existing QuestionWorkspace, never rebuilt', () => {
  it('reuses the exact existing QuestionWorkspace component, never a second implementation', () => {
    expect(source).toContain("import QuestionWorkspace from '@/app/minds/question-workspace'")
    expect(source).not.toMatch(/function\s+QuestionWorkspace/)
  })

  it('reuses the exact existing data fetchers, no new query/RPC', () => {
    expect(source).toContain("import { getEligibleQuestions, getMyAnswers } from '@/lib/questions'")
  })

  it('defaults to the "answers" tab, switches to "new" via ?tab=new', () => {
    expect(source).toContain("tabParam === 'new' ? 'new' : 'answers'")
  })

  it('lives under the You AppShell section, with a way back to You', () => {
    expect(source).toContain('active="you"')
    expect(source).toContain('href="/you"')
  })

  it('requires authentication, same guard as every other You page', () => {
    expect(source).toContain("redirect('/sign-in')")
  })
})

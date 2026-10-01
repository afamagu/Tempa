import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you/responses — compatibility route', () => {
  it('redirects the old response home into Your archive', () => {
    expect(source).toContain("'/you/archive?tab=responses'")
  })

  it('preserves the old ?tab=new intent as archive answer mode', () => {
    expect(source).toContain("'/you/archive?tab=responses&mode=new'")
    expect(source).toContain("tab === 'new'")
  })

  it('does not rebuild response-management UI in the compatibility route', () => {
    expect(source).not.toContain('QuestionWorkspace')
    expect(source).not.toContain('getMyAnswers')
    expect(source).not.toContain('getEligibleQuestions')
  })
})

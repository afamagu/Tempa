import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — People Information Architecture
// (Section F): response management now has an entry point here.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you — links to the new response-management route', () => {
  it('links to /you/responses, labeled "Your responses"', () => {
    expect(source).toContain('href="/you/responses"')
    expect(source).toContain('Your responses')
  })
})

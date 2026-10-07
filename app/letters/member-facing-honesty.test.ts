import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const actionMenu = readFileSync(path.join(__dirname, '[letterId]', 'letter-action-menu.tsx'), 'utf8')
const closureRecommendations = readFileSync(path.join(__dirname, 'closure-recommendations.tsx'), 'utf8')

describe('Letter surfaces — only shipped actions and current terminology', () => {
  it('does not advertise nonfunctional physical-copy or translation actions', () => {
    expect(actionMenu).not.toContain('Send a physical copy')
    expect(actionMenu).not.toContain('Translate')
    expect(actionMenu).not.toContain('coming later')
    expect(actionMenu).not.toContain('not available yet')
    expect(actionMenu).toContain('ReportButton')
    expect(actionMenu).toContain('RemoveFromLetterbox')
    expect(actionMenu).toContain('BlockButton')
  })

  it('uses People terminology after a first-letter closure, never the retired Minds label', () => {
    expect(closureRecommendations).toContain('Other people you might like to meet')
    expect(closureRecommendations).not.toContain('Other minds you might like to meet')
    expect(closureRecommendations).toContain('function PeopleIcon()')
  })
})

import { describe, expect, it } from 'vitest'
import robots from './robots'

describe('public Dispatch preview crawler access', () => {
  it('allows preview agents to fetch shared readers and images without allowing private routes', () => {
    const rules = robots().rules
    if (!Array.isArray(rules)) throw new Error('Expected separate preview rules')
    const social = rules.find(rule => Array.isArray(rule.userAgent) && rule.userAgent.includes('Twitterbot'))!
    expect(social.allow).toContain('/d/')
    expect(social.allow).toContain('/dispatches/')
    expect(social.disallow).toBe('/')
    for (const path of ['/board/', '/letters/', '/admin/', '/api/']) {
      expect(social.allow).not.toContain(path)
    }
  })

  it('does not add token links to general search crawler access', () => {
    const rules = robots().rules
    if (!Array.isArray(rules)) throw new Error('Expected separate preview rules')
    const general = rules.find(rule => rule.userAgent === '*')!
    expect(general.allow).not.toContain('/d/')
    expect(general.disallow).toBe('/')
  })
})

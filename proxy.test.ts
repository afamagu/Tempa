import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'proxy.ts'), 'utf8')

describe('central onboarding enforcement', () => {
  it('uses the shared durable resolver and reads the private onboarding stage', () => {
    expect(source).toContain('resolveOnboardingDestination')
    expect(source).toContain("select('id, onboarding_stage')")
  })

  it('covers authenticated member surfaces, including direct navigation around onboarding', () => {
    for (const route of ['/home/:path*', '/letters/:path*', '/minds/:path*', '/profile/:path*', '/question/:path*', '/write/:path*', '/you/:path*']) {
      expect(source).toContain(`'${route}'`)
    }
  })
})

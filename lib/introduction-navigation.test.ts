import { describe, expect, it } from 'vitest'
import { introductionDestinations, introductionReturnPath } from './introduction-navigation'

describe('Introduction return navigation', () => {
  it('uses canonical profile and writing paths with an explicit Home return', () => {
    expect(introductionDestinations('member','answer')).toEqual({
      profileHref:'/room/member?returnTo=%2Fhome',
      writeHref:'/write/member?a=answer&source=member_introduction&returnTo=%2Fhome',
    })
  })

  it('retains a profile return path including its own Home destination', () => {
    expect(introductionReturnPath('/room/member?returnTo=%2Fhome')).toBe('/room/member?returnTo=%2Fhome')
  })

  it('allows a Dispatch reader, including its finite-session query, as a return destination', () => {
    expect(
      introductionReturnPath('/board/123e4567-e89b-12d3-a456-426614174000?s=now&seed=abc')
    ).toBe('/board/123e4567-e89b-12d3-a456-426614174000?s=now&seed=abc')
  })

  it('rejects external, admin, composing and malformed destinations', () => {
    for (const path of [
      'https://evil.test',
      '//evil.test',
      '/admin',
      '/write/member',
      '/room/member/dispatches',
      '/\\evil.test',
    ]) {
      expect(introductionReturnPath(path)).toBeNull()
    }
  })
})
